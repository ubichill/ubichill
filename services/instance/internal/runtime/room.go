package runtime

import (
	"errors"
	"sort"
	"sync"
	"time"

	"github.com/ubichill/ubichill/services/instance/internal/coord"
)

// Each room serializes state transitions and enqueueing snapshots/events under its
// own lock. Network writes never run under this lock; rooms progress independently.
type Room struct {
	mu         sync.Mutex
	definition Definition
	entities   map[string]Object
	sizes      map[string]int
	bytes      int
	order      map[string]uint64
	sequence   uint64
	members    map[string]*member
	// state は共有状態（state.go）。stateBytes はその大きさの合計。
	state      map[string]*stateEntry
	stateBytes int
	emptySince int64
	closed     bool
	// owner の世代。割り当てのたびに新しい Room を作るので、作ったあとは変わらない。
	gen   string
	epoch int64
	token string
	// deadline は自己停止の期限（mu で守る）。過ぎたら状態変更と入室を止めて部屋を閉じる。
	deadline time.Time
	now      func() time.Time
}
type member struct {
	session *peer
	user    Object
	peer    *peer
	timer   *time.Timer
}

// errUnavailable は部屋が閉じた・自己停止したとき。クライアントはチケットを取り直して入り直せる。
var errUnavailable = errors.New("instance unavailable")

func newRoom(d Definition) (*Room, error) {
	if d.ID == "" || len(d.ID) > 200 || d.MaxUsers < 1 || d.MaxUsers > 1000 || d.Snapshot.Environment == nil || len(d.Snapshot.Entities) > 10000 {
		return nil, errors.New("invalid instance definition")
	}
	r := &Room{definition: d, entities: map[string]Object{}, sizes: map[string]int{}, order: map[string]uint64{}, members: map[string]*member{}, state: map[string]*stateEntry{}, emptySince: time.Now().UnixMilli(), now: time.Now}
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
		e = clone(e)
		if !r.fits(id, e) {
			return nil, errors.New("instance definition is too large")
		}
		r.put(id, e)
	}
	return r, nil
}

// maxRoomBytes bounds the state one room keeps in memory and sends to every joining participant.
const maxRoomBytes = 16 << 20

// maxLocksPerMember bounds how many entities one participant can hold at once, so nobody can lock the whole world.
const maxLocksPerMember = 16

func (r *Room) fits(id string, e Object) bool {
	return r.bytes-r.sizes[id]+len(encoded(e)) <= maxRoomBytes
}
func (r *Room) locksHeldBy(userID string) int {
	n := 0
	for _, e := range r.entities {
		if str(e["lockedBy"]) == userID {
			n++
		}
	}
	return n
}

// Entities keep insertion order so every client renders ties and singleton lookups identically.
func (r *Room) put(id string, e Object) {
	if _, exists := r.order[id]; !exists {
		r.sequence++
		r.order[id] = r.sequence
	}
	r.entities[id] = e
	size := len(encoded(e))
	r.bytes += size - r.sizes[id]
	r.sizes[id] = size
}
func (r *Room) drop(id string) {
	r.bytes -= r.sizes[id]
	delete(r.sizes, id)
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

// usableLocked は部屋が閉じておらず自己停止の期限内かを返す。期限を過ぎていればここで閉じる
// （延長の周期を待たずに、期限を過ぎた最初の操作で止める）。
func (r *Room) usableLocked() bool {
	if r.closed {
		return false
	}
	if !r.now().Before(r.deadline) {
		r.shutdownLocked(false)
		return false
	}
	return true
}
func (r *Room) usable() bool { r.mu.Lock(); defer r.mu.Unlock(); return r.usableLocked() }

// extend は延長が成功したときに期限を延ばす。期限を過ぎて止めた部屋は、あとから延長が成功しても生き返らせない。
func (r *Room) extend(deadline time.Time) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.usableLocked() && deadline.After(r.deadline) {
		r.deadline = deadline
	}
}

// occupancy は Directory に書く在席と、つながっている接続の数。
func (r *Room) occupancy() (coord.RoomPresence, int) {
	r.mu.Lock()
	defer r.mu.Unlock()
	p := coord.RoomPresence{Gen: r.gen, Epoch: r.epoch, Room: r.definition.ID, Members: make([]string, 0, len(r.members)), EmptySince: r.emptySince}
	connected := 0
	for id, m := range r.members {
		p.Members = append(p.Members, id)
		if m.peer != nil {
			connected++
		}
	}
	sort.Strings(p.Members)
	return p, connected
}
func (r *Room) join(p *peer, user Object, id string, request string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if !r.usableLocked() {
		return errUnavailable
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
	r.shutdownLocked(announce)
}
func (r *Room) shutdownLocked(announce bool) {
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
