package runtime

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"slices"
	"sort"
	"time"

	"github.com/ubichill/ubichill/services/instance/internal/coord"
)

// owner の引っ越し（handoff）。クライアントは繋ぎ直さない。
//
//  1. 元の Pod が部屋を凍結し（状態を変えない）、中身を先の Pod に渡して「準備」させる。先はまだ owner ではない。
//  2. 元の Pod が Directory で owner を付け替える（Transfer。token が一致するときだけ。epoch+1、token は先が準備で作ったもの）。
//  3. 先の Pod に「確定」させる。先は自分で延長してから owner になる（延長を送った時刻から自己停止の期限を数える）。
//  4. 元の Pod は、中継されてきた接続には relay:migrate を送り（中継元が繋ぎ直す）、直接繋いでいる接続は自分が中継に変わる。
//
// owner が居ない隙間を作らない（隙間に backend が初期状態で作り直すのを防ぐ）。確定が届かなくても、先は準備の期限に
// Directory を引き、自分に付け替わっていれば自分で確定する。

// handoffSnapshot は引っ越しで渡す部屋の中身。エンティティは作った順に並べる（Definition.Snapshot.Entities）。
type handoffSnapshot struct {
	Definition Definition      `json:"definition"`
	State      []stateEntry    `json:"state"`
	Members    []handoffMember `json:"members"`
	EmptySince int64           `json:"emptySince"`
	CreatedAt  int64           `json:"createdAt"`
}

type handoffMember struct {
	ID   string `json:"id"`
	User Object `json:"user"`
}

type handoffRequest struct {
	Phase string `json:"phase"`
	// To は宛先のノード ID。古いアドレスが別の Pod（再起動・IP の再利用）に当たっても受け付けさせない。
	To       string           `json:"to"`
	From     string           `json:"from,omitempty"`
	Snapshot *handoffSnapshot `json:"snapshot,omitempty"`
}

type pendingHandoff struct {
	room     *Room
	token    string
	from     string
	prepared time.Time
	timer    *time.Timer
}

// maxHandoffBytes は準備で受け取る中身の上限。部屋のエンティティ（16MiB）と共有状態（4MiB）に JSON の余裕を足す。
const maxHandoffBytes = 32 << 20

// migratedGrace は移ってきた参加者が繋ぎ直すまで待つ時間。中継元が繋ぎ直す時間より十分長くする。
func migratedGrace(grace time.Duration) time.Duration { return max(grace, 30*time.Second) }

// migrating は凍結の間の変更系の要求への応答。クライアントは少し待って同じ操作を送り直せる（状態は変えていない）。
func migrating() Object {
	return Object{"success": false, "error": "インスタンスを移動しています", "code": "migrating"}
}

var (
	errNoHandoffTarget = errors.New("no node can take the room")
	errNoHandoff       = errors.New("no prepared handoff for the room")
	errNotTransferred  = errors.New("the room has not been transferred to this node")
	errHandoffLost     = errors.New("the lease of the room was lost during the handoff")
)

func (r *Room) isMigrating() bool { r.mu.Lock(); defer r.mu.Unlock(); return r.migrating }

// freeze は部屋を凍結して中身を写す。凍結より前に応答した変更はすべて写しに入る（変更は r.mu の中で応答する）。
func (r *Room) freeze() (*handoffSnapshot, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if !r.usableLocked() || r.migrating {
		return nil, false
	}
	r.migrating = true
	d := r.definition
	d.Snapshot = r.snapshot()
	h := &handoffSnapshot{Definition: d, State: make([]stateEntry, 0, len(r.state)), Members: make([]handoffMember, 0, len(r.members)), EmptySince: r.emptySince, CreatedAt: r.createdAt}
	for _, e := range r.state {
		h.State = append(h.State, *e)
	}
	sort.Slice(h.State, func(i, j int) bool { return h.State[i].Key < h.State[j].Key })
	for id, m := range r.members {
		h.Members = append(h.Members, handoffMember{ID: id, User: clone(m.user)})
	}
	sort.Slice(h.Members, func(i, j int) bool { return h.Members[i].ID < h.Members[j].ID })
	return h, true
}

// thaw は引っ越しを取りやめて凍結を解く。凍結の間に切れた参加者の猶予はここから数え直す。
func (r *Room) thaw() {
	r.mu.Lock()
	defer r.mu.Unlock()
	if !r.migrating || r.closed {
		return
	}
	r.migrating = false
	for id, m := range r.members {
		if m.peer == nil {
			r.armGrace(id, m, r.grace)
		}
	}
}

// handOver は付け替えの済んだ部屋を閉じ、参加者の接続を返す。接続は閉じない（中継に切り替える）。
// 直接繋いでいる接続の中継は、参加者を外すのと同じロックの中で数に入れる（Drain が接続 0 と見て止まらないように）。
func (r *Room) handOver(s *Server) (relayed []*peer, links []*relayLink) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.closed = true
	for _, m := range r.members {
		if m.timer != nil {
			m.timer.Stop()
		}
		p := m.peer
		switch {
		case p == nil:
		case p.relayed:
			relayed = append(relayed, p)
		case p.pass == nil:
			p.stopAfterSend()
		default:
			l := &relayLink{s: s, p: p, room: r.definition.ID, pass: *p.pass, switching: true}
			s.addLink(l)
			p.link.Store(l)
			links = append(links, l)
		}
	}
	r.members = map[string]*member{}
	return relayed, links
}

// restoreRoom は渡された中身から部屋を作る（まだ owner ではない。確定で世代と期限を入れる）。
func restoreRoom(h handoffSnapshot) (*Room, error) {
	if len(h.Members) > h.Definition.MaxUsers {
		return nil, errors.New("too many members")
	}
	r, err := newRoom(h.Definition)
	if err != nil {
		return nil, err
	}
	r.definition.Snapshot.Entities = nil
	if len(h.State) > maxStateKeys {
		return nil, errStateFull
	}
	for _, e := range h.State {
		var value bytes.Buffer
		if !validStateKey(e.Key) || e.Revision < 1 || e.Revision > maxRevision || r.state[e.Key] != nil ||
			json.Compact(&value, e.Value) != nil || value.Len() > maxStateValueBytes {
			return nil, errStateInvalid
		}
		entry := e
		entry.Value = value.Bytes()
		r.stateBytes += stateSize(&entry)
		if r.stateBytes > maxStateBytes {
			return nil, errStateFull
		}
		r.state[e.Key] = &entry
	}
	for _, m := range h.Members {
		if m.ID == "" || len(m.ID) > 200 || m.User == nil || r.members[m.ID] != nil {
			return nil, errors.New("invalid member")
		}
		user := clone(m.User)
		user["id"] = m.ID
		r.members[m.ID] = &member{user: user, migrated: true}
	}
	r.emptySince, r.createdAt = h.EmptySince, h.CreatedAt
	return r, nil
}

// arrive は確定した部屋の参加者の猶予を数え始める。猶予の間に中継元が繋ぎ直せば、入退室を出さずに戻る。
func (r *Room) arrive(grace time.Duration) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.grace = grace
	for id, m := range r.members {
		r.armGrace(id, m, migratedGrace(grace))
	}
}

// candidate は引っ越し先の候補。
type candidate struct {
	node string
	info coord.NodeInfo
}

// handoffTargets は引っ越し先の候補を、接続の少ない順に返す（自分・draining・空きの無いノード・アドレスの無いノードを除く）。
func handoffTargets(self string, nodes map[string]coord.NodeInfo) []candidate {
	out := make([]candidate, 0, len(nodes))
	for id, info := range nodes {
		if id == self || info.State != coord.NodeReady || info.Addr == "" || info.Rooms >= info.Capacity {
			continue
		}
		out = append(out, candidate{id, info})
	}
	slices.SortFunc(out, func(a, b candidate) int {
		if a.info.Connections != b.info.Connections {
			return a.info.Connections - b.info.Connections
		}
		if a.info.Rooms != b.info.Rooms {
			return a.info.Rooms - b.info.Rooms
		}
		if a.node < b.node {
			return -1
		}
		return 1
	})
	return out
}

// migrate は部屋を別の Pod へ引っ越す。先が見つからない・準備に失敗したら凍結を解いて error を返す（あとで試し直す）。
func (s *Server) migrate(ctx context.Context, r *Room) error {
	if s.config.AdminToken == "" {
		return errNoHandoffTarget
	}
	id := r.definition.ID
	nodes, err := s.dir.Nodes(ctx)
	if err != nil {
		return errors.Join(errDirectoryUnavailable, err)
	}
	targets := handoffTargets(s.node, nodes)
	if len(targets) == 0 {
		return errNoHandoffTarget
	}
	snapshot, ok := r.freeze()
	if !ok {
		return errUnavailable
	}
	for _, to := range targets[:min(len(targets), 3)] {
		started := time.Now()
		var prepared struct {
			Token string `json:"token"`
		}
		if code, err := s.sendHandoff(ctx, to, id, handoffRequest{Phase: "prepare", From: s.node, Snapshot: snapshot}, &prepared); err != nil || code != http.StatusOK || prepared.Token == "" {
			log.Printf("handoff of %s to %s: prepare failed (%d): %v", id, to.node, code, err)
			continue
		}
		// 準備に時間がかかったら、先が準備を捨てる頃に付け替えてしまわないよう取りやめる
		if time.Since(started) > s.handoffTimeout/2 {
			s.abortHandoff(ctx, to, id)
			continue
		}
		gen, _, token := r.lease()
		a, moved, err := s.dir.Transfer(ctx, id, token, to.node, prepared.Token, gen, s.fencing.TTL)
		if err != nil {
			a, moved, err = s.transferOutcome(ctx, id, prepared.Token)
		}
		if err != nil {
			// 付け替えたか分からない。手放して接続を閉じる（クライアントは繋ぎ直す）。付け替わっていれば先が準備の期限に引き取る
			log.Printf("handoff of %s to %s: transfer outcome unknown: %v", id, to.node, err)
			s.discard(ctx, r, false)
			return err
		}
		if !moved {
			s.abortHandoff(ctx, to, id)
			if a.Token == token {
				continue
			}
			s.discard(ctx, r, false)
			return errHandoffLost
		}
		code, err := s.sendHandoff(ctx, to, id, handoffRequest{Phase: "commit"}, nil)
		if err == nil && code != http.StatusOK {
			// 先に準備が無い（捨てた・再起動した）と分かった。先の token で取り戻して凍結を解く
			if s.reclaim(ctx, r, a) {
				log.Printf("handoff of %s to %s: commit refused (%d), took the room back", id, to.node, code)
				continue
			}
			s.discard(ctx, r, false)
			return fmt.Errorf("handoff of %s: commit refused (%d)", id, code)
		}
		if err != nil {
			log.Printf("handoff of %s to %s: commit unanswered (the target commits on its own): %v", id, to.node, err)
		}
		s.handOver(r, migration{Node: a.Node, Addr: to.info.Addr, Gen: a.Gen, Epoch: a.Epoch})
		log.Printf("moved %s to %s (epoch %d)", id, a.Node, a.Epoch)
		return nil
	}
	r.thaw()
	return errNoHandoffTarget
}

// transferOutcome は付け替えの応答が届かなかったときに、Directory を引いて結果を確かめる。
func (s *Server) transferOutcome(ctx context.Context, id, to string) (coord.Assignment, bool, error) {
	owner, held, err := s.dir.Owner(ctx, id)
	if err != nil {
		return coord.Assignment{}, false, err
	}
	if held && owner.Token == to {
		return owner, true, nil
	}
	if held {
		return owner, false, nil
	}
	return coord.Assignment{}, false, nil
}

// reclaim は確定を断られた部屋を、先の token で自分に付け替え直す。先が持っていないと分かっているので奪わない。
func (s *Server) reclaim(ctx context.Context, r *Room, at coord.Assignment) bool {
	token := coord.NewToken()
	sent := s.now()
	a, ok, err := s.dir.Transfer(ctx, r.definition.ID, at.Token, s.node, token, at.Gen, s.fencing.TTL)
	if err != nil || !ok {
		return false
	}
	r.mu.Lock()
	r.epoch, r.token, r.deadline = a.Epoch, a.Token, s.fencing.deadline(sent)
	r.mu.Unlock()
	return true
}

// handOver は付け替えの済んだ部屋の接続を新しい owner へ向ける。中継されてきた接続には relay:migrate を送り、
// 中継元が繋ぎ直して閉じるのを待つ（制御のフレームを知らない中継元の接続は時間で閉じる）。
func (s *Server) handOver(r *Room, to migration) {
	relayed, links := r.handOver(s)
	id := r.definition.ID
	s.mu.Lock()
	if s.rooms[id] == r {
		delete(s.rooms, id)
	}
	s.mu.Unlock()
	control := Frame{Event: migrateEvent, Data: encoded(to)}
	control.raw = encoded(control)
	for _, p := range relayed {
		p.send(control, false)
	}
	for _, l := range links {
		go l.start(&to)
	}
	linger := time.NewTimer(s.handoffTimeout)
	defer linger.Stop()
	for _, p := range relayed {
		select {
		case <-p.done:
		case <-linger.C:
			p.stopAfterSend()
		}
	}
}

func (s *Server) abortHandoff(ctx context.Context, to candidate, id string) {
	_, _ = s.sendHandoff(ctx, to, id, handoffRequest{Phase: "abort"}, nil)
}

var handoffClient = &http.Client{Timeout: 10 * time.Second}

// sendHandoff は先の Pod の管理 API を呼ぶ（管理トークンで認証する）。
func (s *Server) sendHandoff(ctx context.Context, to candidate, id string, body handoffRequest, out any) (int, error) {
	body.To = to.node
	u := "http://" + to.info.Addr + "/realtime/v1/instances/" + url.PathEscape(id) + "/handoff"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, u, bytes.NewReader(encoded(body)))
	if err != nil {
		return 0, err
	}
	req.Header.Set("Authorization", "Bearer "+s.config.AdminToken)
	req.Header.Set("Content-Type", "application/json")
	res, err := handoffClient.Do(req)
	if err != nil {
		return 0, err
	}
	defer res.Body.Close()
	if out != nil && res.StatusCode == http.StatusOK {
		return res.StatusCode, json.NewDecoder(io.LimitReader(res.Body, 1<<20)).Decode(out)
	}
	return res.StatusCode, nil
}

func (s *Server) serveHandoff(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	var body handoffRequest
	if !decodeLimit(w, r, &body, maxHandoffBytes) {
		return
	}
	if body.To != s.node {
		writeJSON(w, http.StatusMisdirectedRequest, failure("handoff is addressed to another node"))
		return
	}
	id := r.PathValue("id")
	switch body.Phase {
	case "prepare":
		if body.Snapshot == nil || body.Snapshot.Definition.ID != id {
			writeJSON(w, 400, failure("snapshot is missing or for another instance"))
			return
		}
		token, err := s.prepareHandoff(id, body.From, *body.Snapshot)
		switch {
		case errors.Is(err, errDraining), errors.Is(err, errNodeFull):
			writeJSON(w, 503, failure(err.Error()))
		case err != nil:
			writeJSON(w, 409, failure(err.Error()))
		default:
			writeJSON(w, 200, Object{"success": true, "token": token})
		}
	case "commit":
		s.provisioning.Lock()
		ctx, cancel := context.WithTimeout(r.Context(), s.fencing.Timeout)
		room, err := s.completeHandoffLocked(ctx, id)
		cancel()
		s.provisioning.Unlock()
		switch {
		case errors.Is(err, errDirectoryUnavailable):
			writeJSON(w, 503, failure(err.Error()))
		case err != nil:
			writeJSON(w, 409, failure(err.Error()))
		default:
			writeJSON(w, 200, s.presenceOf(room))
		}
	case "abort":
		s.dropHandoff(id, nil)
		w.WriteHeader(204)
	default:
		writeJSON(w, 400, failure("unknown phase"))
	}
}

func (s *Server) awaiting(id string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.pending[id] != nil
}

// prepareHandoff は渡された中身で部屋を作って持っておく。handoffTimeout の間に確定しなければ、Directory を確かめて捨てる。
func (s *Server) prepareHandoff(id, from string, h handoffSnapshot) (string, error) {
	s.provisioning.Lock()
	defer s.provisioning.Unlock()
	if s.draining.Load() {
		return "", errDraining
	}
	if s.room(id) != nil {
		return "", errors.New("instance already exists on this node")
	}
	r, err := restoreRoom(h)
	if err != nil {
		return "", err
	}
	p := &pendingHandoff{room: r, token: coord.NewToken(), from: from, prepared: s.now()}
	s.mu.Lock()
	defer s.mu.Unlock()
	if old := s.pending[id]; old != nil {
		old.timer.Stop()
		delete(s.pending, id)
	}
	if len(s.rooms)+len(s.pending) >= s.config.MaxRooms {
		return "", errNodeFull
	}
	p.timer = time.AfterFunc(s.handoffTimeout, func() { s.expireHandoff(id, p) })
	s.pending[id] = p
	return p.token, nil
}

// completeHandoffLocked は準備した部屋を owner として持つ（provisioning のロックの下で呼ぶ）。
// Directory で自分に付け替わっていることを確かめ、自分で延長してから期限を入れる。付け替えの時刻は元の Pod の時計なので使わない。
func (s *Server) completeHandoffLocked(ctx context.Context, id string) (*Room, error) {
	s.mu.RLock()
	p := s.pending[id]
	s.mu.RUnlock()
	if p == nil {
		if r := s.owned(id); r != nil {
			return r, nil
		}
		return nil, errNoHandoff
	}
	owner, held, err := s.dir.Owner(ctx, id)
	if err != nil {
		return nil, errors.Join(errDirectoryUnavailable, err)
	}
	if !held || owner.Node != s.node || owner.Token != p.token {
		return nil, errNotTransferred
	}
	sent := s.now()
	renewal := s.dir.Renew(ctx, s.fencing.TTL, coord.RoomLease{Room: id, Token: p.token})[0]
	if renewal.Err != nil {
		return nil, errors.Join(errDirectoryUnavailable, renewal.Err)
	}
	if !renewal.OK {
		s.dropHandoff(id, p)
		return nil, errHandoffLost
	}
	r := p.room
	r.gen, r.epoch, r.token, r.now, r.deadline = owner.Gen, owner.Epoch, p.token, s.now, s.fencing.deadline(sent)
	s.mu.Lock()
	current := s.gen == owner.Gen && s.pending[id] == p
	if current {
		delete(s.pending, id)
		s.rooms[id] = r
	}
	s.mu.Unlock()
	if !current {
		return nil, errNoHandoff
	}
	p.timer.Stop()
	r.arrive(s.config.Grace)
	log.Printf("took over %s from %s (epoch %d)", id, p.from, owner.Epoch)
	return r, nil
}

// expireHandoff は確定の届かなかった準備の後始末。付け替わっていれば自分で確定し、そうでなければ捨てる。
// Directory に届かない間は、付け替えのリースが切れるまで試し直す（切れたら誰の部屋でもない）。
func (s *Server) expireHandoff(id string, p *pendingHandoff) {
	s.provisioning.Lock()
	defer s.provisioning.Unlock()
	if !s.awaitingThis(id, p) {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), s.fencing.Timeout)
	defer cancel()
	_, err := s.completeHandoffLocked(ctx, id)
	switch {
	case err == nil:
		log.Printf("handoff of %s was not confirmed, but it was transferred here: took it over", id)
	case errors.Is(err, errDirectoryUnavailable) && s.now().Sub(p.prepared) < s.handoffTimeout+s.fencing.TTL:
		s.mu.Lock()
		if s.pending[id] == p {
			p.timer = time.AfterFunc(s.fencing.Retry, func() { s.expireHandoff(id, p) })
		}
		s.mu.Unlock()
	default:
		s.dropHandoff(id, p)
	}
}

func (s *Server) awaitingThis(id string, p *pendingHandoff) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.pending[id] == p
}

// dropHandoff は準備を捨てる。p が nil なら部屋の準備をどれでも捨てる。
func (s *Server) dropHandoff(id string, p *pendingHandoff) {
	s.mu.Lock()
	defer s.mu.Unlock()
	cur := s.pending[id]
	if cur == nil || p != nil && cur != p {
		return
	}
	cur.timer.Stop()
	delete(s.pending, id)
}
