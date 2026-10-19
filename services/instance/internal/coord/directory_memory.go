package coord

import (
	"context"
	"slices"
	"sync"
	"time"
)

// MemoryDirectory は 1 プロセスの中だけの Directory（単体モード・テスト）。
// テストでは複数の Server で 1 つを共有し、ノードの交代を時計を進めて確かめる。
type MemoryDirectory struct {
	mu       sync.Mutex
	now      func() time.Time
	gen      string
	nodes    map[string]expiring[NodeInfo]
	rooms    map[string]expiring[Assignment]
	epochs   map[string]expiring[int64]
	presence map[string]expiring[RoomPresence]
	retired  map[string]expiring[struct{}]
	listed   map[string]bool
}

type expiring[T any] struct {
	value   T
	expires time.Time
}

func NewMemoryDirectory(now func() time.Time) *MemoryDirectory {
	if now == nil {
		now = time.Now
	}
	m := &MemoryDirectory{now: now}
	m.Wipe()
	return m
}

// Wipe はすべてを消す（Redis が全部消えたときの再現）。
func (m *MemoryDirectory) Wipe() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.gen = ""
	m.nodes = map[string]expiring[NodeInfo]{}
	m.rooms = map[string]expiring[Assignment]{}
	m.epochs = map[string]expiring[int64]{}
	m.presence = map[string]expiring[RoomPresence]{}
	m.retired = map[string]expiring[struct{}]{}
	m.listed = map[string]bool{}
}

// live は期限内の値を返す。期限切れはここで消す（Redis の期限切れと同じ見え方にする）。
func live[T any](m map[string]expiring[T], key string, now time.Time) (T, bool) {
	e, ok := m[key]
	if ok && !now.Before(e.expires) {
		delete(m, key)
		var zero T
		return zero, false
	}
	return e.value, ok
}

func (m *MemoryDirectory) ClusterGen(context.Context) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.gen == "" {
		m.gen = newToken()
	}
	return m.gen, nil
}

func (m *MemoryDirectory) Heartbeat(_ context.Context, node string, info NodeInfo, ttl time.Duration) error {
	if err := validate(node, ttl); err != nil {
		return err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.nodes[node] = expiring[NodeInfo]{info, m.now().Add(ttl)}
	return nil
}

func (m *MemoryDirectory) Node(_ context.Context, node string) (NodeInfo, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	info, ok := live(m.nodes, node, m.now())
	return info, ok, nil
}

func (m *MemoryDirectory) Assign(_ context.Context, room, node, gen string, ttl time.Duration) (Assignment, bool, error) {
	if err := validateRoom(room, ttl, true); err != nil {
		return Assignment{}, false, err
	}
	if node == "" {
		return Assignment{}, false, ErrInvalidLease
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.gen == "" || m.gen != gen {
		return Assignment{}, false, ErrGenChanged
	}
	now := m.now()
	if _, ok := live(m.retired, room, now); ok {
		return Assignment{}, false, ErrRetired
	}
	if a, ok := live(m.rooms, room, now); ok {
		return a, false, nil
	}
	epoch, _ := live(m.epochs, room, now)
	epoch++
	m.epochs[room] = expiring[int64]{epoch, now.Add(epochRetention)}
	a := Assignment{Node: node, Epoch: epoch, Token: newToken(), Gen: gen}
	m.rooms[room] = expiring[Assignment]{a, now.Add(ttl)}
	return a, true, nil
}

func (m *MemoryDirectory) Owner(_ context.Context, room string) (Assignment, bool, error) {
	if err := validateRoom(room, 0, false); err != nil {
		return Assignment{}, false, err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	a, ok := live(m.rooms, room, m.now())
	return a, ok, nil
}

func (m *MemoryDirectory) Renew(_ context.Context, ttl time.Duration, leases ...RoomLease) []Renewal {
	out := make([]Renewal, len(leases))
	m.mu.Lock()
	defer m.mu.Unlock()
	now := m.now()
	for i, l := range leases {
		if err := validateRoom(l.Room, ttl, true); err != nil {
			out[i].Err = err
			continue
		}
		a, ok := live(m.rooms, l.Room, now)
		if !ok || a.Token != l.Token {
			continue
		}
		m.rooms[l.Room] = expiring[Assignment]{a, now.Add(ttl)}
		m.epochs[l.Room] = expiring[int64]{a.Epoch, now.Add(epochRetention)}
		out[i].OK = true
	}
	return out
}

func (m *MemoryDirectory) Release(_ context.Context, room, token string) (bool, error) {
	if err := validateRoom(room, 0, false); err != nil {
		return false, err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	a, ok := live(m.rooms, room, m.now())
	if !ok || a.Token != token {
		return false, nil
	}
	delete(m.rooms, room)
	return true, nil
}

func (m *MemoryDirectory) PublishPresence(_ context.Context, rooms []RoomPresence, ttl time.Duration) error {
	for _, p := range rooms {
		if err := validateRoom(p.Room, ttl, true); err != nil {
			return err
		}
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, p := range rooms {
		p.Members = slices.Clone(p.Members)
		m.presence[p.Room] = expiring[RoomPresence]{p, m.now().Add(ttl)}
		m.listed[p.Room] = true
	}
	return nil
}

func (m *MemoryDirectory) Presence(_ context.Context, room string) (RoomPresence, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	p, ok := live(m.presence, room, m.now())
	p.Members = slices.Clone(p.Members)
	return p, ok, nil
}

func (m *MemoryDirectory) Rooms(context.Context) ([]string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]string, 0, len(m.listed))
	for room := range m.listed {
		out = append(out, room)
	}
	slices.Sort(out)
	return out, nil
}

func (m *MemoryDirectory) Forget(_ context.Context, room string) error {
	if err := validateRoom(room, 0, false); err != nil {
		return err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.presence, room)
	delete(m.listed, room)
	return nil
}

func (m *MemoryDirectory) Retire(_ context.Context, room, token string, ttl time.Duration) (bool, error) {
	if err := validateRoom(room, ttl, true); err != nil {
		return false, err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	owner, held := live(m.rooms, room, m.now())
	if held && owner.Token != token || !held && token != "" {
		return false, nil
	}
	m.retired[room] = expiring[struct{}]{struct{}{}, m.now().Add(ttl)}
	delete(m.rooms, room)
	delete(m.presence, room)
	delete(m.listed, room)
	return true, nil
}
