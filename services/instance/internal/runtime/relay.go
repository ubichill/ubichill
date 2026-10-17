package runtime

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
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

// upstream は中継先（owner）への接続。データの書き込みはクライアントから読む goroutine だけが行う。
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
	u := &upstream{conn: conn}
	_ = conn.SetReadDeadline(time.Now().Add(relayIdle))
	conn.SetPingHandler(func(data string) error {
		_ = conn.SetReadDeadline(time.Now().Add(relayIdle))
		err := conn.WriteControl(websocket.PongMessage, []byte(data), time.Now().Add(5*time.Second))
		if errors.Is(err, websocket.ErrCloseSent) {
			return nil
		}
		return err
	})
	s.relayMu.Lock()
	s.relays[u] = struct{}{}
	s.relayMu.Unlock()
	return u, nil
}

func (u *upstream) forward(raw []byte) error {
	_ = u.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
	return u.conn.WriteMessage(websocket.TextMessage, raw)
}

func (u *upstream) close() { u.once.Do(func() { _ = u.conn.Close() }) }

// pump は owner からのフレームをそのままクライアントへ送る。owner が閉じたら（自己停止・終了・退出）、
// 積んだフレームを送り切ってからクライアントも閉じる。クライアントはチケットを取り直して入り直す。
func (u *upstream) pump(p *peer) {
	defer p.stopAfterSend()
	for {
		kind, msg, err := u.conn.ReadMessage()
		if err != nil {
			return
		}
		if kind != websocket.TextMessage {
			continue
		}
		// 揮発のフレームを落とすかは owner が決めている。ここで詰まったら owner からの読み取りを止め、owner 側のキューに任せる
		select {
		case p.out <- Frame{raw: msg}:
		case <-p.done:
			return
		}
	}
}

func (s *Server) forgetRelay(u *upstream) {
	u.close()
	s.relayMu.Lock()
	delete(s.relays, u)
	s.relayMu.Unlock()
}

// closeRelays は中継している接続をすべて閉じる（プロセスの停止）。
func (s *Server) closeRelays() {
	s.relayMu.Lock()
	relays := s.relays
	s.relays = map[*upstream]struct{}{}
	s.relayMu.Unlock()
	for u := range relays {
		u.close()
	}
}
