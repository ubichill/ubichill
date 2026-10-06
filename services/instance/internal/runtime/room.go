package runtime

import (
	"errors"
	"sort"
	"sync"
	"time"
)

// Each room serializes state transitions and enqueueing snapshots/events under its
// own lock. Network writes never run under this lock; rooms progress independently.
type Room struct {
	mu         sync.Mutex
	definition Definition
	entities   map[string]Object
	order      map[string]uint64
	sequence   uint64
	members    map[string]*member
	timelines  map[string]Object
	emptySince int64
	closed     bool
}
type member struct {
	session *peer
	user    Object
	peer    *peer
	timer   *time.Timer
}

func newRoom(d Definition) (*Room, error) {
	if d.ID == "" || len(d.ID) > 200 || d.MaxUsers < 1 || d.MaxUsers > 1000 || d.Snapshot.Environment == nil || len(d.Snapshot.Entities) > 10000 {
		return nil, errors.New("invalid instance definition")
	}
	r := &Room{definition: d, entities: map[string]Object{}, order: map[string]uint64{}, members: map[string]*member{}, timelines: map[string]Object{}, emptySince: time.Now().UnixMilli()}
	for _, e := range d.Snapshot.Entities {
		id := str(e["id"])
		if id == "" || len(id) > 200 {
			return nil, errors.New("invalid entity ID")
		}
		if _, exists := r.entities[id]; exists {
			return nil, errors.New("duplicate entity ID")
		}
		if _, ok := transform(e["transform"], false); !ok {
			return nil, errors.New("invalid entity transform")
		}
		if _, ok := e["data"].(map[string]any); !ok || str(e["type"]) == "" {
			return nil, errors.New("invalid entity")
		}
		r.put(id, clone(e))
	}
	return r, nil
}

// Entities keep insertion order so every client renders ties and singleton lookups identically.
func (r *Room) put(id string, e Object) {
	if _, exists := r.order[id]; !exists {
		r.sequence++
		r.order[id] = r.sequence
	}
	r.entities[id] = e
}
func (r *Room) drop(id string) {
	delete(r.entities, id)
	delete(r.order, id)
}
func (r *Room) presence() Presence {
	r.mu.Lock()
	defer r.mu.Unlock()
	ids := make([]string, 0, len(r.members))
	for id := range r.members {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return Presence{ID: r.definition.ID, Name: r.definition.Name, MaxUsers: r.definition.MaxUsers, MemberIDs: ids, EmptySince: r.emptySince}
}
func (r *Room) broadcast(event string, data any, except *peer, volatile bool) {
	f := Frame{Event: event, Data: encoded(data)}
	for _, m := range r.members {
		if m.peer != nil && m.peer != except {
			m.peer.send(f, volatile)
		}
	}
}
func (r *Room) snapshot() Snapshot {
	s := r.definition.Snapshot
	s.Entities = make([]Object, 0, len(r.entities))
	for _, e := range r.entities {
		s.Entities = append(s.Entities, e)
	}
	sort.Slice(s.Entities, func(i, j int) bool {
		return r.order[str(s.Entities[i]["id"])] < r.order[str(s.Entities[j]["id"])]
	})
	if s.ActiveMods == nil {
		s.ActiveMods = []string{}
	}
	if s.AvailableComponents == nil {
		s.AvailableComponents = []Object{}
	}
	return s
}
func (r *Room) join(p *peer, user Object, id string, request string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.closed {
		return errors.New("instance closed")
	}
	old := r.members[id]
	if old == nil && len(r.members) >= r.definition.MaxUsers {
		return errors.New("instance full")
	}
	if old != nil {
		if old.timer != nil {
			old.timer.Stop()
		}
		if old.peer != nil && old.peer != p {
			old.peer.send(Frame{Event: "session:replaced"}, false)
			old.peer.stopAfterSend()
		}
	}
	user = clone(user)
	user["id"] = id
	user["lastActiveAt"] = time.Now().UnixMilli()
	p.room = r
	p.userID = id
	r.members[id] = &member{user: user, peer: p, session: p}
	r.emptySince = 0
	p.reply(request, Object{"success": true, "userId": id, "instanceId": r.definition.ID})
	users := make([]Object, 0, len(r.members))
	for _, m := range r.members {
		users = append(users, m.user)
	}
	p.send(Frame{Event: "users:update", Data: encoded(users)}, false)
	p.send(Frame{Event: "world:snapshot", Data: encoded(r.snapshot())}, false)
	r.broadcast("user:joined", user, p, false)
	return nil
}
func (r *Room) leave(p *peer, grace time.Duration) {
	r.mu.Lock()
	defer r.mu.Unlock()
	m := r.members[p.userID]
	if m == nil || m.session != p {
		return
	}
	if grace > 0 {
		m.peer = nil
		m.timer = time.AfterFunc(grace, func() {
			r.mu.Lock()
			defer r.mu.Unlock()
			if r.members[p.userID] == m && m.peer == nil {
				r.remove(p.userID)
			}
		})
	} else {
		r.remove(p.userID)
	}
}
func (r *Room) remove(id string) {
	m := r.members[id]
	if m == nil {
		return
	}
	if m.timer != nil {
		m.timer.Stop()
	}
	delete(r.members, id)
	for entityID, e := range r.entities {
		if str(e["lockedBy"]) == id {
			e["lockedBy"] = nil
			data, _ := e["data"].(map[string]any)
			if data == nil {
				data = Object{}
			}
			data["isHeld"] = false
			e["data"] = data
			r.broadcast("entity:patched", Object{"entityId": entityID, "patch": Object{"lockedBy": nil, "data": data}}, nil, false)
		}
	}
	r.broadcast("user:left", id, nil, false)
	if len(r.members) == 0 {
		r.emptySince = time.Now().UnixMilli()
	}
}

// close ends the room. Only a deliberate close announces instance:closing; a process
// shutdown just drops connections so clients reconnect and the room is provisioned again.
func (r *Room) close(announce bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.closed = true
	if announce {
		r.broadcast("instance:closing", "インスタンスが終了しました", nil, false)
	}
	for _, m := range r.members {
		if m.timer != nil {
			m.timer.Stop()
		}
		if m.peer != nil {
			m.peer.stopAfterSend()
		}
	}
	r.members = map[string]*member{}
}
