package runtime

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// Pod 間の中継（WS Router）。接続を受けた Pod は、部屋が手元に無ければ Directory の owner の内部アドレスへ
// WebSocket を張り、最初の world:join から先を双方向に中継する。owner は中継された world:join のチケットと
// 世代を自分で確かめる（中継側を信用しない）。owner は 1 回だけ決め、owner が接続を閉じたら中継も閉じる。
//
// 中継用の口（relayPath）は Ingress に出さない。加えて、管理トークンから派生した鍵の HMAC で
// 「同じクラスタの Pod が、このノードに宛てて、30 秒以内に作った」ことを確かめる。中継用の口は Origin の確認と
// レート制限を中継元に任せるので、外から直接来た接続にそれを飛ばさせないため。
const (
	relayPath     = "/realtime/v1/relay"
	relayHeader   = "X-Ubichill-Relay"
	relayKeyLabel = "ubichill instance relay v1"
	relayValidity = 30 * time.Second
	// relayIdle は中継先から何も届かないときに切るまでの時間。owner は 20 秒ごとに ping を送る。
	relayIdle = 60 * time.Second
)

var (
	errRelayUnauthorized = errors.New("relay credential is missing, invalid or expired")
	errRelayMisdirected  = errors.New("relay is addressed to another node")
)

type relayClaims struct {
	From    string `json:"from"`
	To      string `json:"to"`
	Expires int64  `json:"exp"`
}

// relayKey は管理トークンから派生する（全 Pod で同じ）。管理トークンの無い単体モードでは中継しない。
// 管理トークンを持つ者は管理 API でチケットを発行できるので、中継の鍵を派生しても権限は広がらない。
func relayKey(c Config) []byte {
	if c.AdminToken == "" {
		return nil
	}
	mac := hmac.New(sha256.New, []byte(c.AdminToken))
	mac.Write([]byte(relayKeyLabel))
	return mac.Sum(nil)
}

func (s *Server) relayCredential(to string) string {
	return s.signRelay(relayClaims{From: s.node, To: to, Expires: time.Now().Add(relayValidity).Unix()})
}

func (s *Server) signRelay(c relayClaims) string {
	payload := base64.RawURLEncoding.EncodeToString(encoded(c))
	mac := hmac.New(sha256.New, s.relayKey)
	mac.Write([]byte(payload))
	return payload + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

// verifyRelay は中継の資格を確かめる。宛先のノード ID まで照らすので、古いアドレスが別の Pod（再起動・IP の再利用）に
// 当たっても、その Pod は受け付けない。
func (s *Server) verifyRelay(value string) error {
	if s.relayKey == nil || len(value) > 1024 {
		return errRelayUnauthorized
	}
	payload, sig, ok := strings.Cut(value, ".")
	if !ok {
		return errRelayUnauthorized
	}
	got, err := base64.RawURLEncoding.DecodeString(sig)
	if err != nil {
		return errRelayUnauthorized
	}
	mac := hmac.New(sha256.New, s.relayKey)
	mac.Write([]byte(payload))
	if !hmac.Equal(got, mac.Sum(nil)) {
		return errRelayUnauthorized
	}
	body, err := base64.RawURLEncoding.DecodeString(payload)
	if err != nil {
		return errRelayUnauthorized
	}
	var c relayClaims
	if json.Unmarshal(body, &c) != nil || c.Expires <= time.Now().Unix() {
		return errRelayUnauthorized
	}
	if c.To != s.node {
		return errRelayMisdirected
	}
	return nil
}

func (s *Server) serveRelay(w http.ResponseWriter, r *http.Request) {
	switch err := s.verifyRelay(r.Header.Get(relayHeader)); {
	case errors.Is(err, errRelayMisdirected):
		writeJSON(w, http.StatusMisdirectedRequest, failure(err.Error()))
	case err != nil:
		writeJSON(w, http.StatusUnauthorized, failure(err.Error()))
	default:
		s.serve(w, r, true)
	}
}

// route は手元に無い部屋の owner を Directory から引き、中継先のアドレスを返す。
// 中継できなければ、クライアントに返す world:join の失敗（ticket_invalid / instance_unavailable）を返す。
func (s *Server) route(ctx context.Context, id string, t claims) (target, Object) {
	if s.relayKey == nil {
		return target{}, unavailable()
	}
	owner, held, err := s.dir.Owner(ctx, id)
	if err != nil || !held || owner.Node == s.node {
		// 自分のノードの割り当てなのに部屋が無いのは、自己停止のあとまだ解放していないとき
		return target{}, unavailable()
	}
	if t.Gen != owner.Gen || t.Epoch != owner.Epoch {
		return target{}, ticketInvalid()
	}
	info, alive, err := s.dir.Node(ctx, owner.Node)
	if err != nil || !alive || info.Addr == "" {
		return target{}, unavailable()
	}
	return target{node: owner.Node, addr: info.Addr}, nil
}

type target struct{ node, addr string }

// upstream は中継先（owner）への 1 本の接続。
type upstream struct {
	conn *websocket.Conn
	once sync.Once
}

func (s *Server) dialOwner(ctx context.Context, to target) (*upstream, error) {
	dialer := websocket.Dialer{HandshakeTimeout: 5 * time.Second, NetDialContext: (&net.Dialer{Timeout: 3 * time.Second}).DialContext}
	conn, resp, err := dialer.DialContext(ctx, "ws://"+to.addr+relayPath, http.Header{relayHeader: {s.relayCredential(to.node)}})
	if resp != nil && resp.Body != nil {
		_ = resp.Body.Close()
	}
	if err != nil {
		return nil, err
	}
	_ = conn.SetReadDeadline(time.Now().Add(relayIdle))
	conn.SetPingHandler(func(data string) error {
		_ = conn.SetReadDeadline(time.Now().Add(relayIdle))
		err := conn.WriteControl(websocket.PongMessage, []byte(data), time.Now().Add(5*time.Second))
		if errors.Is(err, websocket.ErrCloseSent) {
			return nil
		}
		return err
	})
	return &upstream{conn: conn}, nil
}

func (u *upstream) forward(raw []byte) error {
	_ = u.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
	return u.conn.WriteMessage(websocket.TextMessage, raw)
}

func (u *upstream) close() { u.once.Do(func() { _ = u.conn.Close() }) }

// 引っ越し（handoff.go）で、元の owner が中継の接続にだけ送る制御のフレーム。中継元が飲み込み、クライアントには届けない。
// owner が送るイベント名はサーバーが決めた固定の名前だけなので、クライアントがこの形のフレームを owner に送らせることはできない。
const migrateEvent = "relay:migrate"

var migratePrefix = []byte(`{"event":"` + migrateEvent + `"`)

// migration は引っ越し先。中継元はここへ繋ぎ直し、チケットを (Gen, Epoch) で署名し直して入り直す。
type migration struct {
	Node  string `json:"node"`
	Addr  string `json:"addr"`
	Gen   string `json:"gen"`
	Epoch int64  `json:"epoch"`
}

type relayPass struct {
	claims claims
	user   Object
}

// maxRelayQueue は繋ぎ直しの間にクライアントから届いたフレームを持っておく数。溢れたら接続を切る（クライアントは繋ぎ直す）。
const maxRelayQueue = 64

var errRelayQueueFull = errors.New("relay queue is full while switching owners")

// relayLink はクライアントの接続 1 本を owner へ中継する経路。owner が引っ越したら、クライアントの接続を保ったまま
// 新しい owner へ繋ぎ直す。クライアントからの書き込みは serve の goroutine、owner からの読み取りは start の goroutine。
type relayLink struct {
	s    *Server
	p    *peer
	room string
	pass relayPass

	mu        sync.Mutex
	up        *upstream
	queue     [][]byte
	switching bool
	closed    bool
}

func (l *relayLink) forward(raw []byte) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.switching {
		if len(l.queue) >= maxRelayQueue {
			return errRelayQueueFull
		}
		l.queue = append(l.queue, raw)
		return nil
	}
	if l.up == nil {
		return errRelayUnavailable
	}
	return l.up.forward(raw)
}

var errRelayUnavailable = errors.New("relay is closed")

func (l *relayLink) close() {
	l.mu.Lock()
	l.closed = true
	up := l.up
	l.up = nil
	l.mu.Unlock()
	if up != nil {
		up.close()
	}
	l.s.dropLink(l)
}

// start は owner からのフレームをクライアントへ送る。to があれば、先にそこへ繋ぎ直す（自分の部屋の参加者を中継に切り替えるとき）。
// owner が閉じたら（自己停止・終了・退出）、積んだフレームを送り切ってからクライアントも閉じる。クライアントはチケットを取り直して入り直す。
func (l *relayLink) start(to *migration) {
	defer l.p.stopAfterSend()
	if to != nil && !l.switchTo(*to) {
		return
	}
	for {
		l.mu.Lock()
		up := l.up
		l.mu.Unlock()
		if up == nil {
			return
		}
		kind, msg, err := up.conn.ReadMessage()
		if err != nil {
			return
		}
		if kind != websocket.TextMessage {
			continue
		}
		if bytes.HasPrefix(msg, migratePrefix) {
			var f struct {
				Data migration `json:"data"`
			}
			if json.Unmarshal(msg, &f) != nil || !l.switchTo(f.Data) {
				return
			}
			continue
		}
		// 揮発のフレームを落とすかは owner が決めている。ここで詰まったら owner からの読み取りを止め、owner 側のキューに任せる
		select {
		case l.p.out <- Frame{raw: msg}:
		case <-l.p.done:
			return
		}
	}
}

// switchTo は新しい owner へ繋ぎ直す。その間にクライアントから届いたフレームは持っておき、入り直したあとに順に送る。
func (l *relayLink) switchTo(to migration) bool {
	l.mu.Lock()
	if l.closed {
		l.mu.Unlock()
		return false
	}
	l.switching = true
	old := l.up
	l.up = nil
	l.mu.Unlock()
	if old != nil {
		old.close()
	}
	up, err := l.rejoin(to)
	l.mu.Lock()
	defer l.mu.Unlock()
	if err == nil && l.closed {
		err = errRelayUnavailable
	}
	for _, raw := range l.queue {
		if err != nil {
			break
		}
		err = up.forward(raw)
	}
	if err != nil {
		if up != nil {
			up.close()
		}
		log.Printf("relay of %s to the new owner %s failed: %v", l.room, to.Node, err)
		return false
	}
	l.queue = nil
	l.up = up
	l.switching = false
	return true
}

// rejoin は新しい owner に入り直す。チケットは中継する Pod が自分で署名し直す（全 Pod で鍵が同じ）。
// 入室の応答はこちらで飲み込む（クライアントは入室済み）。続く users:update・world:snapshot はクライアントへ送る。
func (l *relayLink) rejoin(to migration) (*upstream, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	up, err := l.s.dialOwner(ctx, target{node: to.Node, addr: to.Addr})
	if err != nil {
		return nil, err
	}
	c := l.pass.claims
	c.Gen, c.Epoch, c.Expires = to.Gen, to.Epoch, time.Now().Add(time.Minute).Unix()
	id := "relay:rejoin:" + newID()
	join := encoded(Frame{Event: "world:join", ID: id, Data: encoded(Object{"instanceId": l.room, "token": l.s.signClaims(c), "user": l.pass.user})})
	if err := up.forward(join); err != nil {
		up.close()
		return nil, err
	}
	_ = up.conn.SetReadDeadline(time.Now().Add(10 * time.Second))
	for {
		kind, msg, err := up.conn.ReadMessage()
		if err != nil {
			up.close()
			return nil, err
		}
		if kind != websocket.TextMessage {
			continue
		}
		var f Frame
		if json.Unmarshal(msg, &f) == nil && f.ReplyTo == id {
			if out, _ := object(f.Data); out["success"] != true {
				up.close()
				return nil, fmt.Errorf("rejoin refused: %s", f.Data)
			}
			_ = up.conn.SetReadDeadline(time.Now().Add(relayIdle))
			return up, nil
		}
		l.p.send(Frame{raw: msg}, false)
	}
}

func (s *Server) addLink(l *relayLink) {
	s.relayMu.Lock()
	s.relays[l] = struct{}{}
	s.relayMu.Unlock()
}
func (s *Server) dropLink(l *relayLink) { s.relayMu.Lock(); delete(s.relays, l); s.relayMu.Unlock() }

func (s *Server) relayCount() int { s.relayMu.Lock(); defer s.relayMu.Unlock(); return len(s.relays) }

// addClient・dropClient はこの Pod に直接繋いでいるクライアント（中継されてきた接続を除く）。
func (s *Server) addClient(p *peer)  { s.relayMu.Lock(); s.clients[p] = struct{}{}; s.relayMu.Unlock() }
func (s *Server) dropClient(p *peer) { s.relayMu.Lock(); delete(s.clients, p); s.relayMu.Unlock() }

func (s *Server) directClients() []*peer {
	s.relayMu.Lock()
	defer s.relayMu.Unlock()
	out := make([]*peer, 0, len(s.clients))
	for p := range s.clients {
		out = append(out, p)
	}
	return out
}

// closeRelays は中継している接続をすべて閉じる（プロセスの停止）。
func (s *Server) closeRelays() {
	s.relayMu.Lock()
	relays := s.relays
	s.relays = map[*relayLink]struct{}{}
	s.relayMu.Unlock()
	for l := range relays {
		l.close()
	}
}
