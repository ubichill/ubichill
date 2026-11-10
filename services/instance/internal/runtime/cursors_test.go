package runtime

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

var batchFeatures = []string{featureCursorBatch}

// roomFor は人数の上限を広げた部屋の定義。
func roomFor(id string, maxUsers int) Definition {
	d := definition(id)
	d.MaxUsers = maxUsers
	return d
}

// startBatching はまとめ送りの間隔を指定したサーバー。interval を長くすると、テストが flushCursors を呼んで送る。
func startBatching(t *testing.T, interval time.Duration, configure func(*Config)) (*Server, *httptest.Server) {
	t.Helper()
	config := Config{AdminToken: strings.Repeat("a", 32), Grace: 20 * time.Millisecond, CursorBatch: interval}
	if configure != nil {
		configure(&config)
	}
	s := New(config)
	if _, err := s.Provision(roomFor("a", 50)); err != nil {
		t.Fatal(err)
	}
	h := httptest.NewServer(s.Handler())
	t.Cleanup(func() { s.Close(); h.Close() })
	return s, h
}

// joinAsWith は features を宣言して入室する（features が nil なら宣言しない）。
func joinAsWith(t *testing.T, h *httptest.Server, room, token string, features []string) (*websocket.Conn, Object) {
	t.Helper()
	c := dial(t, h)
	data := Object{"instanceId": room, "token": token, "user": Object{"name": "user", "status": "online", "position": Object{"x": 0, "y": 0}}}
	if features != nil {
		data["features"] = features
	}
	if err := c.WriteJSON(Frame{Event: "world:join", ID: "join", Data: encoded(data)}); err != nil {
		t.Fatal(err)
	}
	out, _ := object(receive(t, c, "join").Data)
	return c, out
}

func enter(t *testing.T, s *Server, h *httptest.Server, room, user string, features []string) *websocket.Conn {
	t.Helper()
	c, out := joinAsWith(t, h, room, s.sign(ticket{room, user, time.Now().Add(time.Minute).Unix(), "member", "", "", false}), features)
	joined(t, out)
	receive(t, c, "world:snapshot")
	return c
}

func move(t *testing.T, c *websocket.Conn, x float64, extra Object) {
	t.Helper()
	data := Object{"position": Object{"x": x, "y": float64(0)}}
	for k, v := range extra {
		data[k] = v
	}
	if err := c.WriteJSON(Frame{Event: "cursor:move", Data: encoded(data)}); err != nil {
		t.Fatal(err)
	}
}

// settle は c から送った要求の応答を待つ（それより前に送った cursor:move が処理済みになる）。
func settle(t *testing.T, c *websocket.Conn) {
	t.Helper()
	if out := request(t, c, "state:get", "settle-"+newID(), Object{"key": "settle"}); out["success"] != true {
		t.Fatalf("settle: %v", out)
	}
}

type cursorOut struct {
	UserID       string `json:"userId"`
	Position     struct{ X, Y float64 }
	HeldEntityID json.RawMessage `json:"heldEntityId"`
}

func batchOf(t *testing.T, c *websocket.Conn) []cursorOut {
	t.Helper()
	var out []cursorOut
	if err := json.Unmarshal(receive(t, c, "cursors:moved").Data, &out); err != nil {
		t.Fatal(err)
	}
	return out
}

func users(batch []cursorOut) []string {
	ids := []string{}
	for _, c := range batch {
		ids = append(ids, c.UserID)
	}
	return ids
}

// 同じ人の複数の move は最新の 1 件だけ。宣言した受け手は 1 フレームで受け、自分の分は含まない。
// 宣言しない受け手には今まで通り 1 件ずつ、すぐ届く。
func TestCursorBatchKeepsTheLatestMovePerUser(t *testing.T) {
	s, h := startBatching(t, time.Hour, nil)
	alice := enter(t, s, h, "a", "alice", batchFeatures)
	bob := enter(t, s, h, "a", "bob", batchFeatures)
	carol := enter(t, s, h, "a", "carol", batchFeatures)
	legacy := enter(t, s, h, "a", "legacy", nil)
	// 知らない機能は読み飛ばし、知っている機能だけを使う
	mixed := enter(t, s, h, "a", "mixed", []string{"unknown:feature", featureCursorBatch})

	move(t, alice, 1, Object{"heldEntityId": "held"})
	move(t, alice, 2, nil)
	move(t, alice, 3, Object{"heldEntityId": "e1"})
	move(t, bob, 10, Object{"heldEntityId": nil})
	move(t, bob, 11, Object{"heldEntityId": strings.Repeat("x", 65)})
	settle(t, alice)
	settle(t, bob)
	// 送り手ごとの順序は保つ（送り手の間の順序は決まらない）
	seen := map[string][]float64{}
	for range 5 {
		var c cursorOut
		if err := json.Unmarshal(receive(t, legacy, "cursor:moved").Data, &c); err != nil {
			t.Fatal(err)
		}
		seen[c.UserID] = append(seen[c.UserID], c.Position.X)
	}
	if !slices.Equal(seen["alice"], []float64{1, 2, 3}) || !slices.Equal(seen["bob"], []float64{10, 11}) {
		t.Fatalf("legacy got %v", seen)
	}
	// 間隔が来るまで宣言した受け手には何も届かない
	expectNone(t, carol, "cursors:moved")
	expectNone(t, carol, "cursor:moved")

	s.room("a").flushCursors()
	got := batchOf(t, carol)
	if !slices.Equal(users(got), []string{"alice", "bob"}) || got[0].Position.X != 3 || got[1].Position.X != 11 {
		t.Fatalf("carol got %+v", got)
	}
	// heldEntityId は cursor:moved と同じ規則（最新の move に有効な値があれば付く。null も付く。長すぎれば付かない）
	if string(got[0].HeldEntityID) != `"e1"` || got[1].HeldEntityID != nil {
		t.Fatalf("heldEntityId: alice=%s bob=%s", got[0].HeldEntityID, got[1].HeldEntityID)
	}
	if got := batchOf(t, mixed); !slices.Equal(users(got), []string{"alice", "bob"}) {
		t.Fatalf("mixed got %v", users(got))
	}
	if got := batchOf(t, alice); !slices.Equal(users(got), []string{"bob"}) {
		t.Fatalf("alice got %v (must not include herself)", users(got))
	}
	if got := batchOf(t, bob); !slices.Equal(users(got), []string{"alice"}) || got[0].Position.X != 3 {
		t.Fatalf("bob got %+v", got)
	}
	expectNone(t, legacy, "cursors:moved")

	// 動いたのが 1 人だけなら、その人には送らない（自分の分しか無い）
	move(t, alice, 4, nil)
	settle(t, alice)
	s.room("a").flushCursors()
	if got := batchOf(t, carol); !slices.Equal(users(got), []string{"alice"}) {
		t.Fatalf("carol got %v", users(got))
	}
	expectNone(t, alice, "cursors:moved")
	// 送ったあとはタイマーを持たない（動きの無い部屋は何もしない）
	r := s.room("a")
	r.mu.Lock()
	idle := r.cursorTimer == nil && len(r.cursors) == 0
	r.mu.Unlock()
	if !idle {
		t.Fatal("a timer or pending cursors remained after the flush")
	}
}

// 間隔 0 は今まで通り。宣言したクライアントにも cursor:moved を 1 件ずつ送り、タイマーを張らない。
func TestCursorBatchDisabledSendsEveryMove(t *testing.T) {
	s, h := startBatching(t, 0, nil)
	alice := enter(t, s, h, "a", "alice", batchFeatures)
	bob := enter(t, s, h, "a", "bob", batchFeatures)
	move(t, alice, 1, nil)
	move(t, alice, 2, nil)
	for _, want := range []string{`"x":1`, `"x":2`} {
		if f := receive(t, bob, "cursor:moved"); !strings.Contains(string(f.Data), want) {
			t.Fatalf("bob got %s", f.Data)
		}
	}
	expectNone(t, bob, "cursors:moved")
	r := s.room("a")
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.cursorTimer != nil || r.cursors != nil {
		t.Fatal("batching state was created with the interval 0")
	}
}

// 宣言した受け手が居なければ持たない（宣言しない人だけの部屋はタイマーを張らない）。
func TestCursorBatchWithoutDeclaredReceiversKeepsNothing(t *testing.T) {
	s, h := startBatching(t, time.Hour, nil)
	alice := enter(t, s, h, "a", "alice", batchFeatures)
	bob := enter(t, s, h, "a", "bob", nil)
	move(t, alice, 1, nil)
	receive(t, bob, "cursor:moved")
	r := s.room("a")
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.cursorTimer != nil || len(r.cursors) != 0 {
		t.Fatal("kept a cursor nobody batches")
	}
}

// 退出した人の分は、user:left のあとに送らない。
func TestCursorBatchDropsUsersWhoLeft(t *testing.T) {
	s, h := startBatching(t, time.Hour, nil)
	alice := enter(t, s, h, "a", "alice", batchFeatures)
	bob := enter(t, s, h, "a", "bob", batchFeatures)
	carol := enter(t, s, h, "a", "carol", batchFeatures)
	move(t, alice, 1, nil)
	move(t, bob, 2, nil)
	settle(t, alice)
	settle(t, bob)
	if out := request(t, alice, "world:leave", "bye", nil); out["success"] != true {
		t.Fatalf("leave: %v", out)
	}
	receive(t, carol, "user:left")
	s.room("a").flushCursors()
	if got := batchOf(t, carol); !slices.Equal(users(got), []string{"bob"}) {
		t.Fatalf("carol got %v after alice left", users(got))
	}
	// 猶予が切れて抜けたときも同じ（猶予の間は居るので送ってよい）
	move(t, bob, 3, nil)
	settle(t, bob)
	_ = bob.Close()
	if f := receive(t, carol, "user:left"); string(f.Data) != `"bob"` {
		t.Fatalf("user:left = %s", f.Data)
	}
	s.room("a").flushCursors()
	expectNone(t, carol, "cursors:moved")
}

// 実際の間隔で送られ、部屋を閉じたらタイマーを止めて持っている分を捨てる。
func TestCursorBatchTimerStopsWhenTheRoomCloses(t *testing.T) {
	s, h := startBatching(t, 20*time.Millisecond, nil)
	alice := enter(t, s, h, "a", "alice", batchFeatures)
	bob := enter(t, s, h, "a", "bob", batchFeatures)
	move(t, alice, 1, nil)
	if got := batchOf(t, bob); !slices.Equal(users(got), []string{"alice"}) {
		t.Fatalf("bob got %v", users(got))
	}
	r := s.room("a")
	eventually(t, "the timer was kept after sending", func() bool {
		r.mu.Lock()
		defer r.mu.Unlock()
		return r.cursorTimer == nil
	})

	r.mu.Lock()
	r.cursorBatch = time.Hour
	r.mu.Unlock()
	move(t, alice, 2, nil)
	settle(t, alice)
	r.mu.Lock()
	armed := r.cursorTimer != nil
	r.mu.Unlock()
	if !armed {
		t.Fatal("no timer for a pending cursor")
	}
	r.close(false)
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.cursorTimer != nil || r.cursors != nil {
		t.Fatal("the timer or the pending cursors survived the close")
	}
}

// 引っ越しを繋ぐ全ての経路で宣言が残る: 中継されてきた接続（中継元が入り直す）、元の owner に直接繋いでいた接続
// （元の owner が中継に変わって入り直す）。宣言しない接続は宣言しないまま。
func TestCursorBatchDeclarationSurvivesMigration(t *testing.T) {
	c := newCluster()
	batching := func(config *Config) { config.CursorBatch = time.Hour }
	a := startPodWith(t, c.dir, "node-a", c.clock.Now, batching)
	b := startPodWith(t, c.dir, "node-b", c.clock.Now, batching)
	edge := startPodWith(t, c.dir, "node-c", c.clock.Now, batching)
	for _, n := range []*node{a, b, edge} {
		n.maintain()
	}
	if _, err := a.Provision(roomFor("room", 10)); err != nil {
		t.Fatal(err)
	}
	a.maintain()
	alice, out := joinAsWith(t, edge.http, "room", memberGrant(t, a, "room", "alice"), batchFeatures)
	joined(t, out)
	bob, out := joinAsWith(t, a.http, "room", memberGrant(t, a, "room", "bob"), batchFeatures)
	joined(t, out)
	legacy, out := joinAsWith(t, a.http, "room", memberGrant(t, a, "room", "legacy"), nil)
	joined(t, out)

	// 中継は中身を見ずに通すので、宣言は owner まで届く
	move(t, bob, 1, nil)
	settle(t, bob)
	a.room("room").flushCursors()
	if got := batchOf(t, alice); !slices.Equal(users(got), []string{"bob"}) {
		t.Fatalf("relayed alice got %v", users(got))
	}

	edge.maintain()
	if err := a.migrate(context.Background(), a.room("room")); err != nil {
		t.Fatal(err)
	}
	moved := b.owned("room")
	if moved == nil {
		t.Fatal("the room did not move")
	}
	eventually(t, "the participants did not come back", func() bool { return moved.connected() == 3 })
	moved.mu.Lock()
	declared := map[string]bool{}
	for id, m := range moved.members {
		declared[id] = m.peer.batchCursors
	}
	moved.mu.Unlock()
	if !declared["alice"] || !declared["bob"] || declared["legacy"] {
		t.Fatalf("declarations after the handoff: %v", declared)
	}
	move(t, legacy, 5, nil)
	settle(t, legacy)
	moved.flushCursors()
	for _, c := range []*websocket.Conn{alice, bob} {
		if got := batchOf(t, c); !slices.Equal(users(got), []string{"legacy"}) {
			t.Fatalf("after the handoff got %v", users(got))
		}
	}
	move(t, alice, 6, nil)
	if f := receive(t, legacy, "cursor:moved"); !strings.Contains(string(f.Data), `"alice"`) {
		t.Fatalf("legacy got %s", f.Data)
	}
}

func TestKnownFeaturesIgnoresUnknownAndMalformedValues(t *testing.T) {
	for _, tc := range []struct {
		in   any
		want []string
	}{
		{nil, nil},
		{"cursors:batch", nil},
		{[]any{float64(1), Object{"cursors:batch": true}, "CURSORS:BATCH"}, nil},
		{[]any{"x", "cursors:batch", "cursors:batch"}, []string{"cursors:batch"}},
	} {
		if got := knownFeatures(tc.in); !slices.Equal(got, tc.want) {
			t.Fatalf("knownFeatures(%v) = %v, want %v", tc.in, got, tc.want)
		}
	}
}

// 連結で作るフレームは、Frame を符号化したものと同じ JSON になる。
func TestCursorsFrameMatchesTheEncodedFrame(t *testing.T) {
	entries := []cursorEntry{{"a", encoded(Object{"userId": "a"})}, {"b", encoded(Object{"userId": "b", "heldEntityId": nil})}}
	for skip, want := range map[string][]Object{
		"":  {{"userId": "a"}, {"userId": "b", "heldEntityId": nil}},
		"a": {{"userId": "b", "heldEntityId": nil}},
		"z": {{"userId": "a"}, {"userId": "b", "heldEntityId": nil}},
	} {
		got := cursorsFrame(entries, skip).raw
		if string(got) != string(encoded(Frame{Event: "cursors:moved", Data: encoded(want)})) {
			t.Fatalf("skip %q: %s", skip, got)
		}
	}
	if got := string(cursorsFrame(entries[:1], "a").raw); got != `{"event":"cursors:moved","data":[]}` {
		t.Fatalf("empty frame: %s", got)
	}
}
