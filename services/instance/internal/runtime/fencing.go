package runtime

import (
	"context"
	"errors"
	"log"
	"time"

	"github.com/ubichill/ubichill/services/instance/internal/coord"
)

// Fencing は owner のリースの時間。ゼロの項目は既定値になる。
//
// 自己停止の期限は「最後に延長が成功した要求を送った時刻 + TTL − Margin」。Redis がキーの期限を数え始めるのは
// 要求を受けた時刻（送った時刻より後）なので、新しい owner が取得できるのは早くても自己停止の Margin 後になる。
// Margin は時計の進み方の差・GC やスケジューラの遅れ・処理中の操作の終わりを吸収する。
// Interval ごとに延長し、失敗したら Retry ごとに試し直す（TTL − Margin の間に何度か試せる長さにする）。
type Fencing struct {
	TTL      time.Duration
	Margin   time.Duration
	Interval time.Duration
	Retry    time.Duration
	// Timeout は 1 回の Directory の操作（延長・heartbeat・割り当て）にかける上限。
	Timeout time.Duration
}

func (f Fencing) withDefaults() Fencing {
	def := Fencing{TTL: 15 * time.Second, Margin: 5 * time.Second, Interval: 5 * time.Second, Retry: time.Second, Timeout: 2 * time.Second}
	if f.TTL <= 0 {
		f.TTL = def.TTL
	}
	if f.Margin <= 0 {
		f.Margin = def.Margin
	}
	if f.Interval <= 0 {
		f.Interval = def.Interval
	}
	if f.Retry <= 0 {
		f.Retry = def.Retry
	}
	if f.Timeout <= 0 {
		f.Timeout = def.Timeout
	}
	if f.Margin >= f.TTL {
		panic("fencing: margin must be shorter than ttl")
	}
	return f
}

// deadline は延長の要求を送った時刻から、自己停止の期限を求める。
func (f Fencing) deadline(sent time.Time) time.Time { return sent.Add(f.TTL - f.Margin) }

var errDirectoryUnavailable = errors.New("instance directory is unavailable")

// ownedElsewhere は部屋の owner が別のノードのとき（G2 の振り分けで使う owner の情報を返す）。
type ownedElsewhere struct {
	owner coord.Assignment
	addr  string
	alive bool
}

func (e *ownedElsewhere) Error() string { return "instance is owned by another node" }

// generation は知っているクラスタの世代を返す。まだ知らなければ Directory に聞く。
func (s *Server) generation(ctx context.Context) (string, error) {
	s.mu.RLock()
	gen := s.gen
	s.mu.RUnlock()
	if gen != "" {
		return gen, nil
	}
	return s.observeGeneration(ctx)
}

// observeGeneration は Directory の世代を読み、変わっていれば（Redis が全部消えた）全部屋を捨てて接続を閉じる。
func (s *Server) observeGeneration(ctx context.Context) (string, error) {
	gen, err := s.dir.ClusterGen(ctx)
	if err != nil {
		return "", err
	}
	s.mu.Lock()
	var dropped []*Room
	if s.gen != "" && s.gen != gen {
		for _, r := range s.rooms {
			dropped = append(dropped, r)
		}
		s.rooms = map[string]*Room{}
	}
	s.gen = gen
	s.mu.Unlock()
	if len(dropped) > 0 {
		log.Printf("cluster generation changed: dropping %d rooms", len(dropped))
	}
	for _, r := range dropped {
		r.close(false)
	}
	return gen, nil
}

// assign は部屋を自分に割り当てる。sent は割り当ての要求を送った時刻（自己停止の期限の起点）。
func (s *Server) assign(ctx context.Context, id string) (coord.Assignment, time.Time, error) {
	for range 3 {
		gen, err := s.generation(ctx)
		if err != nil {
			return coord.Assignment{}, time.Time{}, errors.Join(errDirectoryUnavailable, err)
		}
		sent := s.now()
		a, created, err := s.dir.Assign(ctx, id, s.node, gen, s.fencing.TTL)
		if errors.Is(err, coord.ErrGenChanged) {
			if _, err := s.observeGeneration(ctx); err != nil {
				return coord.Assignment{}, time.Time{}, errors.Join(errDirectoryUnavailable, err)
			}
			continue
		}
		if errors.Is(err, coord.ErrInvalidRoom) || errors.Is(err, coord.ErrRetired) {
			return coord.Assignment{}, time.Time{}, err
		}
		if err != nil {
			return coord.Assignment{}, time.Time{}, errors.Join(errDirectoryUnavailable, err)
		}
		if a.Node != s.node {
			info, alive, err := s.dir.Node(ctx, a.Node)
			if err != nil {
				return coord.Assignment{}, time.Time{}, errors.Join(errDirectoryUnavailable, err)
			}
			return coord.Assignment{}, time.Time{}, &ownedElsewhere{owner: a, addr: info.Addr, alive: alive}
		}
		if created {
			return a, sent, nil
		}
		// 自分のノードの割り当てだが手元に部屋が無い（自己停止のあとに解放できなかった）。
		// そのまま使うと前の部屋のチケットが通るので、token で解放して新しい epoch で取り直す。
		if _, err := s.dir.Release(ctx, id, a.Token); err != nil {
			return coord.Assignment{}, time.Time{}, errors.Join(errDirectoryUnavailable, err)
		}
	}
	return coord.Assignment{}, time.Time{}, errDirectoryUnavailable
}

// discard は部屋を手放す。接続は再接続できる閉じ方（instance:closing を送らない）で閉じる。
// release は token が一致するときだけ効くので、すでに別の owner に移っていても奪わない。
func (s *Server) discard(ctx context.Context, r *Room, release bool) {
	id := r.definition.ID
	s.mu.Lock()
	if s.rooms[id] == r {
		delete(s.rooms, id)
	}
	s.mu.Unlock()
	r.close(false)
	if release {
		_, _ = s.dir.Release(ctx, id, r.token)
	}
}

// maintain は 1 回分の heartbeat・延長・自己停止・在席の書き込み。失敗があれば false（早めに試し直す）。
func (s *Server) maintain(ctx context.Context) bool {
	s.maintaining.Lock()
	defer s.maintaining.Unlock()
	healthy := true
	if _, err := s.observeGeneration(ctx); err != nil {
		healthy = false
	}
	s.mu.RLock()
	rooms := make([]*Room, 0, len(s.rooms))
	for _, r := range s.rooms {
		rooms = append(rooms, r)
	}
	s.mu.RUnlock()
	usable := make([]*Room, 0, len(rooms))
	leases := make([]coord.RoomLease, 0, len(rooms))
	for _, r := range rooms {
		if r.usable() {
			usable = append(usable, r)
			leases = append(leases, coord.RoomLease{Room: r.definition.ID, Token: r.token})
		}
	}
	sent := s.now()
	lost := make(map[*Room]bool)
	for i, renewal := range s.dir.Renew(ctx, s.fencing.TTL, leases...) {
		r := usable[i]
		switch {
		case renewal.Err != nil:
			healthy = false
		case !renewal.OK:
			log.Printf("lost the lease of %s (epoch %d): closing it", r.definition.ID, r.epoch)
			s.discard(ctx, r, false)
			lost[r] = true
		default:
			r.extend(s.fencing.deadline(sent))
		}
	}
	presence := make([]coord.RoomPresence, 0, len(rooms))
	connections := 0
	for _, r := range rooms {
		if lost[r] {
			continue
		}
		if !r.usable() {
			log.Printf("could not renew the lease of %s (epoch %d) in time: closing it", r.definition.ID, r.epoch)
			s.discard(ctx, r, true)
			continue
		}
		p, connected := r.occupancy()
		presence = append(presence, p)
		connections += connected
	}
	if err := s.dir.PublishPresence(ctx, presence, s.fencing.TTL); err != nil {
		healthy = false
	}
	state := coord.NodeReady
	if s.draining.Load() {
		state = coord.NodeDraining
	}
	info := coord.NodeInfo{
		Addr: s.config.Addr, StartedAt: s.started.UnixMilli(), State: state, Rooms: len(presence),
		Connections: connections + s.relayCount(), Capacity: s.config.MaxRooms,
	}
	if err := s.dir.Heartbeat(ctx, s.node, info, s.fencing.TTL); err != nil {
		healthy = false
	}
	return healthy
}

func (s *Server) loop(ctx context.Context) {
	defer close(s.loopDone)
	for {
		round, cancel := context.WithTimeout(ctx, s.fencing.Timeout)
		healthy := s.maintain(round)
		cancel()
		wait := s.fencing.Interval
		if !healthy {
			wait = s.fencing.Retry
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(wait):
		}
	}
}

// presenceOf は管理 API に返す在席。owner の情報（backend が続く管理 API を送る先と、付ける世代）を足す。
func (s *Server) presenceOf(r *Room) Presence {
	p := r.presence()
	p.Node, p.Gen, p.Epoch, p.Addr = s.node, r.gen, r.epoch, s.config.Addr
	return p
}

// beginDrain は新しい部屋の割り当てを断り始め（readiness も 503 になる）、ノードの状態を draining にしてすぐ書き直す
// （次の heartbeat を待つと、その間 backend が新しい部屋をこのノードに選び続ける）。持っている部屋と接続はそのまま動かす。
func (s *Server) beginDrain() {
	// 作成の途中の要求が終わってから印を付ける。戻ったあとは新しい部屋が生まれない
	s.provisioning.Lock()
	first := s.draining.CompareAndSwap(false, true)
	s.provisioning.Unlock()
	if !first {
		return
	}
	log.Printf("draining: refusing new rooms")
	ctx, cancel := context.WithTimeout(context.Background(), s.fencing.Timeout)
	defer cancel()
	s.maintain(ctx)
}

// Drain は draining に入り、接続（部屋の参加者と中継）が無くなるか ctx が終わるまで待つ。そのあと Close で残りを閉じる。
func (s *Server) Drain(ctx context.Context) {
	s.beginDrain()
	tick := time.NewTicker(200 * time.Millisecond)
	defer tick.Stop()
	for s.connections() > 0 {
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		}
	}
}

// connections は部屋の参加者の接続と、ほかの Pod の部屋へ中継している接続の数。
func (s *Server) connections() int {
	s.mu.RLock()
	rooms := make([]*Room, 0, len(s.rooms))
	for _, r := range s.rooms {
		rooms = append(rooms, r)
	}
	s.mu.RUnlock()
	n := s.relayCount()
	for _, r := range rooms {
		_, connected := r.occupancy()
		n += connected
	}
	return n
}
