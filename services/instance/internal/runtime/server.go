package runtime

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/ubichill/ubichill/services/instance/internal/coord"
	"github.com/ubichill/ubichill/services/instance/internal/protocol"
)

type Config struct {
	AdminToken string
	// TicketKey は参加チケットの署名鍵。空なら AdminToken から派生する（ticketKey を参照）。
	TicketKey string
	Guests    bool
	Origins   []string
	Grace     time.Duration
	// Directory は部屋の割り当て。nil ならメモリ（単体モード）。Redis を設定したら Redis だけを使う。
	Directory coord.Directory
	// Node はこのプロセスのノード ID（coord.NewNodeID）。空なら起動ごとに作る。
	Node string
	// Addr は他の Pod から届く自分のアドレス（heartbeat に書く。G2 の振り分けで使う）。
	Addr    string
	Fencing Fencing
	// Clock は自己停止の期限を測る時計。time.Now の値は monotonic clock を持つので、壁時計の変更の影響を受けない。
	Clock func() time.Time
}
type Server struct {
	retired      map[string]time.Time
	mu           sync.RWMutex
	rooms        map[string]*Room
	gen          string
	admission    sync.Mutex
	provisioning sync.Mutex
	active       map[string]*peer
	key          []byte
	config       Config
	dir          coord.Directory
	node         string
	now          func() time.Time
	fencing      Fencing
	started      time.Time
	stop         context.CancelFunc
	stopOnce     sync.Once
	loopDone     chan struct{}
	relayKey     []byte
	relayMu      sync.Mutex
	relays       map[*upstream]struct{}
}

// New は Server を作り、heartbeat と owner のリースの延長を始める（Close で止める）。
func New(config Config) *Server {
	s := newServer(config)
	ctx, cancel := context.WithCancel(context.Background())
	s.stop = cancel
	s.loopDone = make(chan struct{})
	go s.loop(ctx)
	return s
}

// newServer は延長を自動では回さない Server（テストで時計を進めて maintain を呼ぶ）。
func newServer(config Config) *Server {
	if config.Clock == nil {
		config.Clock = time.Now
	}
	if config.Directory == nil {
		config.Directory = coord.NewMemoryDirectory(config.Clock)
	}
	if config.Node == "" {
		config.Node = coord.NewNodeID("")
	}
	return &Server{
		retired: map[string]time.Time{}, rooms: map[string]*Room{}, active: map[string]*peer{}, key: ticketKey(config), config: config,
		dir: config.Directory, node: config.Node, now: config.Clock, fencing: config.Fencing.withDefaults(), started: time.Now(),
		relayKey: relayKey(config), relays: map[*upstream]struct{}{},
	}
}

// Provision は部屋を自分に割り当てて作る。自分が owner のまま生きている部屋はそのまま返す（冪等）。
func (s *Server) Provision(d Definition) (*Room, error) { return s.provision(d, expectation{}) }

// errStaleGeneration は世代を指定した作成で、その世代の部屋がこの Pod に無いとき。
var errStaleGeneration = errors.New("instance generation does not match")

// provision は部屋を返すか作る。世代を指定したときは、その世代の部屋を返すだけで作らない。
// 世代の確認と作るかどうかの判断を同じ provisioning のロックの下で行う（外で確かめると、確かめた直後に
// fencing で部屋が捨てられ、古い世代を指定した要求が新しい epoch の部屋を作ってしまう）。
func (s *Server) provision(d Definition, want expectation) (*Room, error) {
	s.provisioning.Lock()
	defer s.provisioning.Unlock()
	ctx, cancel := context.WithTimeout(context.Background(), s.fencing.Timeout)
	defer cancel()
	if want.set {
		if r := s.owned(d.ID); r != nil && want.matches(r) {
			return r, nil
		}
		return nil, errStaleGeneration
	}
	// Idempotent creation never resets an existing room, including an empty world.
	if r := s.room(d.ID); r != nil {
		if r.usable() {
			return r, nil
		}
		s.discard(ctx, r, true)
	}
	s.mu.Lock()
	for id, until := range s.retired {
		if time.Now().After(until) {
			delete(s.retired, id)
		}
	}
	_, retired := s.retired[d.ID]
	full := len(s.rooms) >= 1000
	s.mu.Unlock()
	if retired {
		return nil, errors.New("instance has been closed")
	}
	if full {
		return nil, errors.New("instance limit reached")
	}
	r, err := newRoom(d)
	if err != nil {
		return nil, err
	}
	a, sent, err := s.assign(ctx, d.ID)
	if err != nil {
		return nil, err
	}
	r.gen, r.epoch, r.token, r.now, r.deadline = a.Gen, a.Epoch, a.Token, s.now, s.fencing.deadline(sent)
	s.mu.Lock()
	current := s.gen == a.Gen
	if current {
		s.rooms[d.ID] = r
	}
	s.mu.Unlock()
	if !current {
		// 割り当てのあいだに世代が変わった。前の世代の割り当ては新しい世代では無効なので捨てる
		s.discard(ctx, r, true)
		return nil, errDirectoryUnavailable
	}
	return r, nil
}
func (s *Server) room(id string) *Room { s.mu.RLock(); defer s.mu.RUnlock(); return s.rooms[id] }

// Close はプロセスの停止。部屋を閉じ（instance:closing は送らない）、割り当てを解放して、
// 次に起動した Pod が TTL を待たずに部屋を作り直せるようにする。
func (s *Server) Close() {
	s.stopOnce.Do(func() {
		if s.stop != nil {
			s.stop()
			<-s.loopDone
		}
	})
	s.closeRelays()
	s.mu.Lock()
	rooms := s.rooms
	s.rooms = map[string]*Room{}
	s.mu.Unlock()
	ctx, cancel := context.WithTimeout(context.Background(), s.fencing.Timeout)
	defer cancel()
	for id, r := range rooms {
		r.close(false)
		_, _ = s.dir.Release(ctx, id, r.token)
	}
}

// owned は自分が今の owner で、自己停止の期限内の部屋だけを返す。
func (s *Server) owned(id string) *Room {
	if r := s.room(id); r != nil && r.usable() {
		return r
	}
	return nil
}
func (s *Server) originAllowed(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true
	}
	u, err := url.Parse(origin)
	if err == nil && u.Host == r.Host {
		return true
	}
	for _, allowed := range s.config.Origins {
		if origin == allowed {
			return true
		}
	}
	return false
}
func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}
func decode(w http.ResponseWriter, r *http.Request, v any) bool {
	d := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8<<20))
	d.DisallowUnknownFields()
	if d.Decode(v) != nil {
		writeJSON(w, 400, failure("invalid JSON"))
		return false
	}
	var extra any
	if d.Decode(&extra) != io.EOF {
		writeJSON(w, 400, failure("invalid JSON"))
		return false
	}
	return true
}
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) { writeJSON(w, 200, Object{"status": "ok"}) })
	mux.HandleFunc("GET /realtime/v1/ws", s.serveSocket)
	mux.HandleFunc("GET "+relayPath, s.serveRelay)
	mux.HandleFunc("GET /realtime/v1/instances", func(w http.ResponseWriter, r *http.Request) {
		if !s.authorize(w, r) {
			return
		}
		s.mu.RLock()
		rooms := make([]*Room, 0, len(s.rooms))
		for _, room := range s.rooms {
			rooms = append(rooms, room)
		}
		s.mu.RUnlock()
		list := []Presence{}
		for _, room := range rooms {
			if room.usable() {
				list = append(list, s.presenceOf(room))
			}
		}
		writeJSON(w, 200, Object{"instances": list})
	})
	mux.HandleFunc("PUT /realtime/v1/instances/{id}", func(w http.ResponseWriter, r *http.Request) {
		if !s.authorize(w, r) {
			return
		}
		var d Definition
		if !decode(w, r, &d) {
			return
		}
		if d.ID != r.PathValue("id") {
			writeJSON(w, 400, failure("id mismatch"))
			return
		}
		want, ok := expected(w, r)
		if !ok {
			return
		}
		// 世代を指定した作成は、その世代の部屋の確認だけ（新しい epoch で作り直さない）
		room, err := s.provision(d, want)
		var elsewhere *ownedElsewhere
		switch {
		case errors.Is(err, errStaleGeneration):
			writeJSON(w, 409, s.staleGeneration(r.Context(), d.ID))
		case errors.As(err, &elsewhere):
			writeJSON(w, 409, conflict(elsewhere))
		case errors.Is(err, errDirectoryUnavailable):
			writeJSON(w, 503, failure(errDirectoryUnavailable.Error()))
		case err != nil:
			writeJSON(w, 400, failure(err.Error()))
		default:
			writeJSON(w, 200, s.presenceOf(room))
		}
	})
	mux.HandleFunc("GET /realtime/v1/instances/{id}", func(w http.ResponseWriter, r *http.Request) {
		if !s.config.Guests && !s.authorize(w, r) {
			return
		}
		room := s.owned(r.PathValue("id"))
		if room == nil {
			writeJSON(w, 404, failure("instance not found"))
			return
		}
		p := s.presenceOf(room)
		if s.config.Guests {
			p.MemberIDs = []string{}
			p.Node, p.Gen, p.Epoch, p.Addr = "", "", 0, ""
		}
		writeJSON(w, 200, p)
	})
	mux.HandleFunc("DELETE /realtime/v1/instances/{id}", func(w http.ResponseWriter, r *http.Request) {
		if !s.authorize(w, r) {
			return
		}
		want, ok := expected(w, r)
		if !ok {
			return
		}
		code, body := s.closeInstance(r.Context(), r.PathValue("id"), r.URL.Query().Get("emptyBefore"), want)
		if body == nil {
			w.WriteHeader(code)
			return
		}
		writeJSON(w, code, body)
	})
	mux.HandleFunc("POST /realtime/v1/instances/{id}/tickets", func(w http.ResponseWriter, r *http.Request) {
		if !s.authorize(w, r) {
			return
		}
		var body struct {
			UserID string `json:"userId"`
			Name   string `json:"name"`
		}
		if !decode(w, r, &body) {
			return
		}
		want, ok := expected(w, r)
		if !ok {
			return
		}
		room := s.owned(r.PathValue("id"))
		if want.set && !want.matches(room) {
			writeJSON(w, 409, s.staleGeneration(r.Context(), r.PathValue("id")))
			return
		}
		if body.UserID == "" || len(body.UserID) > 200 || room == nil || body.Name != "" && !validName(body.Name) {
			writeJSON(w, 400, failure("invalid participant or instance"))
			return
		}
		s.grant(w, r, room, body.UserID, body.Name, "member", time.Minute*2)
	})
	mux.HandleFunc("POST /realtime/v1/instances/{id}/guest", func(w http.ResponseWriter, r *http.Request) {
		if !s.config.Guests {
			writeJSON(w, 403, failure("guest mode disabled"))
			return
		}
		room := s.owned(r.PathValue("id"))
		if room == nil {
			writeJSON(w, 404, failure("instance not found"))
			return
		}
		var body struct {
			ResumeToken string `json:"resumeToken"`
		}
		if !decode(w, r, &body) {
			return
		}
		id := "guest:" + newID()
		if body.ResumeToken != "" {
			// 世代が違えば前の部屋のゲストなので、同じ ID を引き継がない
			if t, err := s.verify(body.ResumeToken, r.PathValue("id")); err == nil && t.Kind == "guest" && room.issued(t) {
				id = t.Subject
			}
		}
		s.grant(w, r, room, id, "", "guest", 24*time.Hour)
	})
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !s.originAllowed(r) {
			writeJSON(w, 403, failure("origin not allowed"))
			return
		}
		if origin := r.Header.Get("Origin"); origin != "" {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(204)
			return
		}
		mux.ServeHTTP(w, r)
	})
}
func (s *Server) authorize(w http.ResponseWriter, r *http.Request) bool {
	token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	if !strings.HasPrefix(r.Header.Get("Authorization"), "Bearer ") || s.config.AdminToken == "" || subtle.ConstantTimeCompare([]byte(token), []byte(s.config.AdminToken)) != 1 {
		writeJSON(w, 401, failure("unauthorized"))
		return false
	}
	return true
}

// grant はチケットを発行する。発行するのは owner 自身なので、部屋の今の世代を入れる。
func (s *Server) grant(w http.ResponseWriter, r *http.Request, room *Room, id, name, kind string, ttl time.Duration) {
	if room == nil {
		writeJSON(w, 404, failure("instance not found"))
		return
	}
	t := ticket{r.PathValue("id"), id, time.Now().Add(ttl).Unix(), kind, name}
	writeJSON(w, 200, Object{"token": s.signFor(room, t), "userId": id, "expiresAt": t.Expires * 1000, "url": "/realtime/v1/ws", "protocolVersion": 1})
}

// closeInstance は自分が今の owner のときだけ部屋を閉じ、割り当てを token で解放する。
func (s *Server) closeInstance(ctx context.Context, id, emptyBefore string, want expectation) (int, any) {
	s.provisioning.Lock()
	defer s.provisioning.Unlock()
	ctx, cancel := context.WithTimeout(ctx, s.fencing.Timeout)
	defer cancel()
	room := s.owned(id)
	// 呼び出し側が見ていたのと別の世代の部屋（作り直された部屋）は閉じない
	if room != nil && want.set && !want.matches(room) {
		return 409, s.staleGeneration(ctx, id)
	}
	if room == nil {
		if stale := s.room(id); stale != nil {
			s.discard(ctx, stale, true)
		}
		owner, held, err := s.dir.Owner(ctx, id)
		if err != nil && !errors.Is(err, coord.ErrInvalidRoom) {
			return 503, failure(errDirectoryUnavailable.Error())
		}
		if held && owner.Node != s.node {
			info, alive, err := s.dir.Node(ctx, owner.Node)
			if err != nil {
				return 503, failure(errDirectoryUnavailable.Error())
			}
			return 409, conflict(&ownedElsewhere{owner: owner, addr: info.Addr, alive: alive})
		}
		if held {
			// 自分のノードの割り当てだが部屋が無い（自己停止のあと解放できなかった）
			_, _ = s.dir.Release(ctx, id, owner.Token)
		}
		s.mu.Lock()
		s.retired[id] = time.Now().Add(2 * time.Minute)
		s.mu.Unlock()
		return 204, nil
	}
	room.mu.Lock()
	// 部屋の終了は外に影響するので、直前にリースがまだ有効かを確かめる
	if !room.usableLocked() {
		room.mu.Unlock()
		s.discard(ctx, room, true)
		return 503, failure("instance lease expired")
	}
	if emptyBefore != "" {
		before, err := strconv.ParseInt(emptyBefore, 10, 64)
		if err != nil || len(room.members) > 0 || room.emptySince > before {
			room.mu.Unlock()
			return 409, failure("instance is occupied or recently emptied")
		}
	}
	room.closed = true
	room.mu.Unlock()
	room.close(true)
	s.mu.Lock()
	if s.rooms[id] == room {
		delete(s.rooms, id)
	}
	s.retired[id] = time.Now().Add(2 * time.Minute)
	s.mu.Unlock()
	_, _ = s.dir.Release(ctx, id, room.token)
	_ = s.dir.Forget(ctx, id)
	return 204, nil
}

// expectation は管理 API の ?gen=&epoch=（backend が知っている部屋の世代）。付いていなければ照らさない。
type expectation struct {
	set   bool
	gen   string
	epoch int64
}

func (e expectation) matches(r *Room) bool {
	return !e.set || r != nil && r.gen == e.gen && r.epoch == e.epoch
}

// expected は ?gen=&epoch= を読む。片方だけ・数でない epoch は 400 を返して false。
func expected(w http.ResponseWriter, r *http.Request) (expectation, bool) {
	q := r.URL.Query()
	gen, epoch := q.Get("gen"), q.Get("epoch")
	if gen == "" && epoch == "" {
		return expectation{}, true
	}
	n, err := strconv.ParseInt(epoch, 10, 64)
	if gen == "" || err != nil || n < 1 {
		writeJSON(w, 400, failure("gen and epoch must be given together"))
		return expectation{}, false
	}
	return expectation{set: true, gen: gen, epoch: n}, true
}

// staleGeneration は世代が合わないときの 409。今の owner が分かれば付ける（backend はそこへ送り直す）。
func (s *Server) staleGeneration(ctx context.Context, id string) protocol.Conflict {
	c := protocol.Conflict{Success: protocol.ConflictSuccessFalse, Error: "instance is not at the expected generation"}
	ctx, cancel := context.WithTimeout(ctx, s.fencing.Timeout)
	defer cancel()
	owner, held, err := s.dir.Owner(ctx, id)
	if err != nil || !held {
		return c
	}
	info, alive, err := s.dir.Node(ctx, owner.Node)
	if err != nil {
		return c
	}
	c.Owner = conflict(&ownedElsewhere{owner: owner, addr: info.Addr, alive: alive}).Owner
	return c
}

func conflict(e *ownedElsewhere) protocol.Conflict {
	return protocol.Conflict{Success: protocol.ConflictSuccessFalse, Error: e.Error(), Owner: &protocol.InstanceOwner{
		Node: e.owner.Node, Gen: e.owner.Gen, Epoch: e.owner.Epoch, Addr: e.addr, Alive: e.alive,
	}}
}
