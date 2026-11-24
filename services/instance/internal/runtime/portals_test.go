package runtime

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"reflect"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func portalAt(room string, x, y float64) Object { return Object{"room": room, "x": x, "y": y} }

// testGrantKey は start の管理トークンから派生した許可の鍵。
var testGrantKey = portalGrantKey(Config{AdminToken: strings.Repeat("a", 32)})

// signGrant は backend と同じ形の許可を作る（roomPortalGrantToken.ts の signRoomPortalGrant）。
func signGrant(key []byte, g portalGrant) string {
	payload := base64.RawURLEncoding.EncodeToString(encoded(g))
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte(payload))
	return payload + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func grantFor(user, room string) string {
	return signGrant(testGrantKey, portalGrant{Room: room, UserID: user, Exp: time.Now().Add(time.Minute).Unix()})
}

// portalBy は user が backend の許可を付けて送る portal:open。
func portalBy(user, room string, x, y float64) Object {
	payload := portalAt(room, x, y)
	payload["grant"] = grantFor(user, room)
	return payload
}

// pinClock は部屋の時計を止めて、進める関数を返す。
func pinClock(r *Room, at time.Time) func(time.Duration) {
	clock := &fakeClock{now: at}
	r.mu.Lock()
	r.now = clock.Now
	r.mu.Unlock()
	return clock.Advance
}

func setLifetime(r *Room, d time.Duration) {
	r.mu.Lock()
	r.portalLifetime = d
	r.mu.Unlock()
}

func entityOf(t *testing.T, f Frame) Object {
	t.Helper()
	e, ok := object(f.Data)
	if !ok {
		t.Fatalf("entity: %s", f.Data)
	}
	return e
}

func deletedID(t *testing.T, c *websocket.Conn) string {
	t.Helper()
	var id string
	if f := receive(t, c, "entity:deleted"); json.Unmarshal(f.Data, &id) != nil || id == "" {
		t.Fatalf("entity:deleted: %s", f.Data)
	}
	return id
}

// openPortal は応答より前に、置いた本人にも entity:created が届くことを確かめて、作られた Entity を返す。
func openPortal(t *testing.T, c *websocket.Conn, id string, payload Object) Object {
	t.Helper()
	if err := c.WriteJSON(Frame{Event: "portal:open", ID: id, Data: encoded(payload)}); err != nil {
		t.Fatal(err)
	}
	_ = c.SetReadDeadline(time.Now().Add(2 * time.Second))
	var created Object
	for {
		var f Frame
		if err := c.ReadJSON(&f); err != nil {
			t.Fatal(err)
		}
		if f.Event == "entity:created" {
			created = entityOf(t, f)
			continue
		}
		if f.ReplyTo == id {
			if out, _ := object(f.Data); out["success"] != true {
				t.Fatalf("portal:open: %v", out)
			}
			if created == nil {
				t.Fatal("置いた本人に entity:created が応答より前に届かない")
			}
			return created
		}
	}
}

func roomPortalsIn(r *Room) []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.roomPortals(func(Object) bool { return true })
}

func TestValidRoomAddressMatchesShared(t *testing.T) {
	label := strings.Repeat("a", 63)
	domain253 := label + "." + label + "." + label + "." + strings.Repeat("a", 61)
	accepted := []string{
		"abc", "A-b_c", strings.Repeat("a", 64), "abc@example.com", "abc@Example.COM", "abc@localhost:3000",
		"abc@a-b.c-d", "abc@1.2.3.4", "abc@x.com:12345", strings.Repeat("a", 64) + "@" + domain253,
	}
	rejected := []string{
		"", "a@", "@x", "@", "a@b@c", strings.Repeat("a", 65), "a b", "a.b", "a/b",
		"a@-x.com", "a@x-.com", "a@x..com", "a@.x", "a@x.", "a@x.com:", "a@x.com:123456", "a@exa_mple.com",
		"a@x.com/path", "a@テスト.jp", "a@\u0130.com", "a@" + domain253 + "a",
		// JS の toLowerCase は KELVIN SIGN を 'k' にして通すが、Go は ASCII だけを小文字にして断る（厳しい側にずらす）
		"a@\u212aa.com",
		"a\n", "a@x.com\n", "\na",
	}
	for _, v := range accepted {
		if !validRoomAddress(v) {
			t.Errorf("断った: %q", v)
		}
	}
	for _, v := range rejected {
		if validRoomAddress(v) {
			t.Errorf("通した: %q", v)
		}
	}
}

func TestIsRoomPortal(t *testing.T) {
	cases := []struct {
		name string
		e    Object
		want bool
	}{
		{"部屋へのポータル", Object{"type": "core:portal", "ownerId": "alice", "data": map[string]any{"room": "x", "expiresAt": float64(1)}}, true},
		{"ワールドのポータル", Object{"type": "core:portal", "ownerId": nil, "data": map[string]any{"world": "@me/home", "label": ""}}, false},
		{"持ち主の無い room", Object{"type": "core:portal", "ownerId": nil, "data": map[string]any{"room": "x"}}, false},
		{"空の持ち主", Object{"type": "core:portal", "ownerId": "", "data": map[string]any{"room": "x"}}, false},
		{"room の無い core:portal", Object{"type": "core:portal", "ownerId": "alice", "data": map[string]any{"world": "x"}}, false},
		{"mod の Entity", Object{"type": "x:portal", "ownerId": "alice", "data": map[string]any{"room": "x"}}, false},
		{"data が無い", Object{"type": "core:portal", "ownerId": "alice"}, false},
	}
	for _, c := range cases {
		if got := isRoomPortal(c.e); got != c.want {
			t.Errorf("%s: %v", c.name, got)
		}
	}
}

func TestPortalOpenCreatesTheEntityForEveryone(t *testing.T) {
	s, h := start(t, false)
	pinClock(s.room("a"), time.UnixMilli(1_000_000))
	// 名前は SNS が保証するチケットの名前（クライアントの送る名前ではない）
	alice, out := joinWith(t, h, "a", s.sign(ticket{"a", "alice", time.Now().Add(time.Minute).Unix(), "member", "アリス", "", false}))
	joined(t, out)
	bob := connect(t, s, h, "a", "bob")
	receive(t, alice, "user:joined")

	payload := portalBy("alice", "Room_1@Example.COM:8080", 500, 400)
	payload["ownerName"] = "偽物"
	created := openPortal(t, alice, "open", payload)
	want := Object{
		"id": created["id"], "type": "core:portal", "ownerId": "alice", "lockedBy": nil,
		"transform": map[string]any{"x": float64(400), "y": float64(285), "z": float64(0), "w": float64(200), "h": float64(230), "scale": float64(1), "rotation": float64(0)},
		// 住所は送られたまま（小文字にしない）
		"data": map[string]any{"room": "Room_1@Example.COM:8080", "expiresAt": float64(1_060_000), "ownerName": "アリス"},
	}
	if !ref(created["id"]) || !reflect.DeepEqual(created, want) {
		t.Fatalf("作られた Entity:\n got %v\nwant %v", created, want)
	}
	if got := entityOf(t, receive(t, bob, "entity:created")); !reflect.DeepEqual(got, want) {
		t.Fatalf("bob に届いた Entity: %v", got)
	}
	// あとから入った人はスナップショットで受け取る
	_, snapshot := join(t, s, h, "a", "carol")
	if len(snapshot.Entities) != 1 || !reflect.DeepEqual(Object(snapshot.Entities[0]), want) {
		t.Fatalf("スナップショット: %v", snapshot.Entities)
	}
}

func TestPortalOpenRejectsInvalidInput(t *testing.T) {
	s, h := start(t, false)
	alice := connect(t, s, h, "a", "alice")
	bob := connect(t, s, h, "a", "bob")
	// 書式を確かめるところまで届くよう、許可は送った住所に合わせて付ける（許可そのものは TestPortalOpenRequiresGrant）
	granted := grantFor("alice", "abc")
	cases := map[string]any{
		"住所が無い":        Object{"x": float64(0), "y": float64(0), "grant": grantFor("alice", "")},
		"住所が空":         portalBy("alice", "", 0, 0),
		"住所が数":         Object{"room": float64(1), "x": float64(0), "y": float64(0), "grant": granted},
		"@ で終わる":       portalBy("alice", "a@", 0, 0),
		"@ で始まる":       portalBy("alice", "@x", 0, 0),
		"@ が 2 つ":      portalBy("alice", "a@b@c", 0, 0),
		"65 文字の ID":    portalBy("alice", strings.Repeat("a", 65), 0, 0),
		"x が無い":        Object{"room": "abc", "y": float64(0), "grant": granted},
		"x が文字列":       Object{"room": "abc", "x": "NaN", "y": float64(0), "grant": granted},
		"y が null":     Object{"room": "abc", "x": float64(0), "y": nil, "grant": granted},
		"x が遠い":        portalBy("alice", "abc", 1e7+1, 0),
		"y が遠い":        portalBy("alice", "abc", 0, -1e8),
		"x がとても大きい":    portalBy("alice", "abc", 1e308, 0),
		"左上が範囲の外":      portalBy("alice", "abc", -1e7, 0),
		"data が配列":     []any{"abc", 0, 0},
		"data が文字列の住所": "abc",
	}
	for name, payload := range cases {
		if out := request(t, alice, "portal:open", "bad-"+name, payload); out["success"] != false || str(out["error"]) == "" {
			t.Errorf("%s: %v", name, out)
		}
	}
	// JSON の float64 に収まらない数（Inf にはならず、x が抜ける）
	if err := alice.WriteJSON(Frame{Event: "portal:open", ID: "overflow", Data: []byte(`{"room":"abc","x":1e400,"y":0,"grant":"` + granted + `"}`)}); err != nil {
		t.Fatal(err)
	}
	if out, _ := object(receive(t, alice, "overflow").Data); out["success"] != false {
		t.Fatalf("overflow: %v", out)
	}
	// 要求の ID が無いと応答できないので、置かない
	_ = alice.WriteJSON(Frame{Event: "portal:open", Data: encoded(portalBy("alice", "abc", 0, 0))})
	receive(t, alice, "error")
	_ = alice.WriteJSON(Frame{Event: "portal:close"})
	receive(t, alice, "error")

	expectNone(t, bob, "entity:created")
	if ids := entityIDs(s.room("a")); len(ids) != 0 {
		t.Fatalf("断った要求で置かれた: %v", ids)
	}
}

func TestPortalCooldownAndReplace(t *testing.T) {
	s, h := start(t, false)
	advance := pinClock(s.room("a"), time.UnixMilli(1_000_000))
	alice := connect(t, s, h, "a", "alice")
	bob := connect(t, s, h, "a", "bob")

	first := openPortal(t, alice, "first", portalBy("alice", "one", 0, 0))
	receive(t, bob, "entity:created")
	if out := request(t, alice, "portal:open", "fast", portalBy("alice", "two", 0, 0)); out["success"] != false {
		t.Fatalf("続けて置けた: %v", out)
	}
	advance(roomPortalCooldown - time.Millisecond)
	if out := request(t, alice, "portal:open", "still-fast", portalBy("alice", "two", 0, 0)); out["success"] != false {
		t.Fatalf("間隔の前に置けた: %v", out)
	}
	// 間隔は人ごと
	openPortal(t, bob, "bob", portalBy("bob", "bobs", 0, 0))
	receive(t, alice, "entity:created")

	advance(time.Millisecond)
	second := openPortal(t, alice, "second", portalBy("alice", "two", 10, 10))
	// 前のものを消してから、新しいものを配る
	if id := deletedID(t, bob); id != first["id"] {
		t.Fatalf("消えたもの: %s, want %s", id, first["id"])
	}
	if got := entityOf(t, receive(t, bob, "entity:created")); got["id"] != second["id"] {
		t.Fatalf("新しいもの: %v", got)
	}
	r := s.room("a")
	r.mu.Lock()
	own := r.portalsOf("alice")
	r.mu.Unlock()
	if !slices.Equal(own, []string{str(second["id"])}) || len(roomPortalsIn(r)) != 2 {
		t.Fatalf("alice のポータル: %v / 全部: %v", own, roomPortalsIn(r))
	}
	// 断られた要求は間隔を数え直さない
	advance(roomPortalCooldown)
	if out := request(t, alice, "portal:open", "invalid", portalBy("alice", "a@", 0, 0)); out["success"] != false {
		t.Fatal(out)
	}
	openPortal(t, alice, "third", portalBy("alice", "three", 0, 0))
}

func TestPortalRoomCap(t *testing.T) {
	s, h := start(t, false)
	alice := connect(t, s, h, "a", "alice")
	bob := connect(t, s, h, "a", "bob")
	far := float64(time.Now().Add(time.Hour).UnixMilli())
	put := func(id, owner string) {
		putEntity(s, "a", Object{"id": id, "type": "core:portal", "ownerId": owner, "lockedBy": nil, "transform": fullTransform(), "data": Object{"room": "x", "expiresAt": far}})
	}
	for i := range maxRoomPortals - 1 {
		put(fmt.Sprintf("other-%02d", i), fmt.Sprintf("user-%02d", i))
	}
	put("alices", "alice")
	// ワールドのポータルは数えない
	putEntity(s, "a", Object{"id": "gate::0", "type": "core:portal", "entityId": "gate", "ownerId": nil, "lockedBy": nil, "transform": fullTransform(), "data": Object{"world": "@me/home", "label": ""}})

	if out := request(t, bob, "portal:open", "bob", portalBy("bob", "abc", 0, 0)); out["success"] != false {
		t.Fatalf("上限を超えて置けた: %v", out)
	}
	// 置き直す人の前のものは消えるので数えない
	openPortal(t, alice, "alice", portalBy("alice", "abc", 0, 0))
	if id := deletedID(t, bob); id != "alices" {
		t.Fatalf("消えたもの: %s", id)
	}
	if n := len(roomPortalsIn(s.room("a"))); n != maxRoomPortals {
		t.Fatalf("部屋のポータル: %d", n)
	}
	// 1 つ閉じれば置ける
	if out := request(t, alice, "portal:close", "close", nil); out["success"] != true {
		t.Fatal(out)
	}
	openPortal(t, bob, "bob-again", portalBy("bob", "abc", 0, 0))
}

func TestPortalClose(t *testing.T) {
	s, h := start(t, false)
	alice := connect(t, s, h, "a", "alice")
	bob := connect(t, s, h, "a", "bob")
	// 置いていなくても成功で、何も配らない
	if out := request(t, alice, "portal:close", "none", nil); out["success"] != true {
		t.Fatalf("close: %v", out)
	}
	expectNone(t, bob, "entity:deleted")

	mine := openPortal(t, alice, "open", portalBy("alice", "abc", 0, 0))
	receive(t, bob, "entity:created")
	theirs := openPortal(t, bob, "bob", portalBy("bob", "abc", 0, 0))
	receive(t, alice, "entity:created")
	if out := request(t, alice, "portal:close", "close", nil); out["success"] != true {
		t.Fatalf("close: %v", out)
	}
	if id := deletedID(t, bob); id != mine["id"] {
		t.Fatalf("消えたもの: %s", id)
	}
	if got := roomPortalsIn(s.room("a")); !slices.Equal(got, []string{str(theirs["id"])}) {
		t.Fatalf("残ったもの: %v", got)
	}
	if out := request(t, alice, "portal:close", "again", nil); out["success"] != true {
		t.Fatal(out)
	}
	expectNone(t, bob, "entity:deleted")
}

// 先に消えるものへタイマーを張り直す（あとから置いたものが先に消えることもある）。
func TestPortalsExpireInOrder(t *testing.T) {
	s, h := start(t, false)
	r := s.room("a")
	alice := connect(t, s, h, "a", "alice")
	bob := connect(t, s, h, "a", "bob")
	setLifetime(r, 400*time.Millisecond)
	late := openPortal(t, alice, "late", portalBy("alice", "abc", 0, 0))
	receive(t, bob, "entity:created")
	setLifetime(r, 100*time.Millisecond)
	early := openPortal(t, bob, "early", portalBy("bob", "abc", 0, 0))
	receive(t, alice, "entity:created")

	for _, want := range []Object{early, late} {
		if id := deletedID(t, alice); id != want["id"] {
			t.Fatalf("消えた順: %s, want %s", id, want["id"])
		}
	}
	if len(roomPortalsIn(r)) != 0 {
		t.Fatal("消えていない")
	}
	r.mu.Lock()
	armed := r.portalTimer != nil
	r.mu.Unlock()
	if armed {
		t.Fatal("ポータルが無いのにタイマーが残っている")
	}
}

// ワールドのポータル・mod の Entity は、閉じる・期限で消さない。利用者は core:portal を作れない。
func TestPortalLeavesOtherEntitiesAlone(t *testing.T) {
	s, h := start(t, false)
	d := definition("w")
	d.Snapshot.Entities = []Object{{"id": "gate::0", "type": "core:portal", "entityId": "gate", "ownerId": nil, "lockedBy": nil, "transform": fullTransform(), "data": Object{"world": "@me/home", "label": ""}}}
	r, err := s.Provision(d)
	if err != nil {
		t.Fatal(err)
	}
	setLifetime(r, 50*time.Millisecond)
	alice := connect(t, s, h, "w", "alice")
	bob := connect(t, s, h, "w", "bob")

	forged := Object{"type": "core:portal", "transform": fullTransform(), "data": Object{"room": "abc", "expiresAt": float64(0)}}
	if out := request(t, alice, "entity:create", "forge", forged); out["success"] != false {
		t.Fatalf("core:portal を作れた: %v", out)
	}
	look := createEntity(t, alice, Object{"room": "abc", "expiresAt": float64(0)})
	receive(t, bob, "entity:created")
	portal := openPortal(t, alice, "open", portalBy("alice", "abc", 0, 0))
	receive(t, bob, "entity:created")
	if id := deletedID(t, bob); id != portal["id"] {
		t.Fatalf("消えたもの: %s", id)
	}
	if out := request(t, alice, "portal:close", "close", nil); out["success"] != true {
		t.Fatal(out)
	}
	expectNone(t, bob, "entity:deleted")
	if got := entityIDs(r); !slices.Equal(got, []string{"gate::0", look}) {
		t.Fatalf("残った Entity: %v", got)
	}
}

func zOf(e Object) float64 { return num(e["transform"].(map[string]any)["z"]) }

func entityAtZ(id string, z float64, overlay any) Object {
	t := fullTransform()
	t["z"] = z
	e := Object{"id": id, "type": "w:thing", "entityId": id, "ownerId": nil, "lockedBy": nil, "transform": t, "data": Object{}}
	if overlay != nil {
		e["overlay"] = overlay
	}
	return e
}

// 弾幕のワールドのように、ワールド全体を覆う範囲（z: 5000）の上にも出す。画面に固定する Entity は比べない
func TestPortalOpensInFront(t *testing.T) {
	s, h := start(t, false)
	d := definition("w")
	d.Snapshot.Entities = []Object{
		entityAtZ("ship", 10, nil),
		entityAtZ("field", 5000, nil),
		entityAtZ("pad", 9000, "fill"),
		entityAtZ("badge", 8000, true),
		entityAtZ("plain", 4000, false),
	}
	if _, err := s.Provision(d); err != nil {
		t.Fatal(err)
	}
	advance := pinClock(s.room("w"), time.UnixMilli(1_000_000))
	alice := connect(t, s, h, "w", "alice")
	bob := connect(t, s, h, "w", "bob")

	if got := zOf(openPortal(t, alice, "alice", portalBy("alice", "abc", 400, 300))); got != 5001 {
		t.Fatalf("alice の z: %v", got)
	}
	receive(t, bob, "entity:created")
	// あとから置いたものは前のポータルより前
	if got := zOf(openPortal(t, bob, "bob", portalBy("bob", "abc", 400, 300))); got != 5002 {
		t.Fatalf("bob の z: %v", got)
	}
	receive(t, alice, "entity:created")
	// 置き直すと消える自分の前のものは比べない（置き直すたびに上がり続けない）
	advance(roomPortalCooldown)
	if got := zOf(openPortal(t, alice, "again", portalBy("alice", "abc", 400, 300))); got != 5003 {
		t.Fatalf("置き直した z: %v", got)
	}
	advance(roomPortalCooldown)
	if got := zOf(openPortal(t, alice, "again-2", portalBy("alice", "abc", 400, 300))); got != 5003 {
		t.Fatalf("もう一度置き直した z: %v", got)
	}
}

func TestFrontZ(t *testing.T) {
	cases := []struct {
		name     string
		entities []Object
		except   []string
		want     float64
	}{
		{"空の部屋", nil, nil, 0},
		{"いちばん大きいものの 1 つ上", []Object{entityAtZ("a", 3, nil), entityAtZ("b", 5000, nil), entityAtZ("c", -2, nil)}, nil, 5001},
		{"負だけなら 0（背景より奥に描かない）", []Object{entityAtZ("a", -10, nil), entityAtZ("b", -3, nil)}, nil, 0},
		{"-0.5 も 0", []Object{entityAtZ("a", -0.5, nil)}, nil, 0},
		{"0 の上は 1", []Object{entityAtZ("a", 0, nil)}, nil, 1},
		{"小数は整数にして上へ", []Object{entityAtZ("a", 5000.5, nil)}, nil, 5001},
		{"上限を超えるなら上限", []Object{entityAtZ("a", maxCoordinate, nil)}, nil, maxCoordinate},
		{"上限の手前の小数", []Object{entityAtZ("a", maxCoordinate-0.5, nil)}, nil, maxCoordinate},
		{"画面に固定するものだけ", []Object{entityAtZ("a", 9000, "top-left"), entityAtZ("b", 100, true)}, nil, 0},
		{"空の overlay はワールド", []Object{entityAtZ("a", 40, ""), entityAtZ("b", 9000, "fill")}, nil, 41},
		{"消すものは比べない", []Object{entityAtZ("a", 10, nil), entityAtZ("old", 20, nil)}, []string{"old"}, 11},
	}
	for _, c := range cases {
		r := &Room{entities: map[string]Object{}}
		for _, e := range c.entities {
			r.entities[str(e["id"])] = e
		}
		if got := r.frontZ(c.except); got != c.want {
			t.Errorf("%s: %v, want %v", c.name, got, c.want)
		}
		if _, ok := transform(Object{"x": 0.0, "y": 0.0, "z": c.want, "w": 1.0, "h": 1.0, "scale": 1.0, "rotation": 0.0}, false); !ok {
			t.Errorf("%s: transform が断る z: %v", c.name, c.want)
		}
	}
}

func TestPortalCannotBeMovedOrDeletedByAnyone(t *testing.T) {
	s, h := start(t, false)
	alice := connect(t, s, h, "a", "alice")
	bob := connect(t, s, h, "a", "bob")
	portal := openPortal(t, alice, "open", portalBy("alice", "abc", 0, 0))
	receive(t, bob, "entity:created")
	id := str(portal["id"])
	for name, patch := range map[string]Object{
		"移動":     {"transform": Object{"x": float64(5)}},
		"行き先":    {"data": Object{"room": "elsewhere", "expiresAt": float64(9e15)}},
		"持つ":     {"lockedBy": "alice"},
		"持ち主の変更": {"ownerId": "bob"},
	} {
		if out := request(t, alice, "entity:patch", "patch-"+name, Object{"entityId": id, "patch": patch}); out["success"] != false {
			t.Errorf("%s: %v", name, out)
		}
	}
	for _, c := range []*websocket.Conn{alice, bob} {
		if out := request(t, c, "entity:delete", "delete-"+newID(), id); out["success"] != false {
			t.Errorf("delete: %v", out)
		}
	}
	expectNone(t, bob, "entity:patched")
	expectNone(t, alice, "entity:deleted")
	if got := entityIn(s, "a", id); !reflect.DeepEqual(got, portal) {
		t.Fatalf("変わった: %v", got)
	}
}

// 持ち主が先に通って部屋を出ても消さない。戻ってくれば自分のものとして閉じられる。
func TestPortalOutlivesItsOwner(t *testing.T) {
	s, h := start(t, false)
	alice := connect(t, s, h, "a", "alice")
	bob := connect(t, s, h, "a", "bob")
	portal := openPortal(t, alice, "open", portalBy("alice", "abc", 0, 0))
	receive(t, bob, "entity:created")
	if out := request(t, alice, "world:leave", "bye", nil); out["success"] != true {
		t.Fatalf("leave: %v", out)
	}
	receive(t, bob, "user:left")
	expectNone(t, bob, "entity:deleted")
	if entityIn(s, "a", str(portal["id"])) == nil {
		t.Fatal("持ち主が出たら消えた")
	}
	back := connect(t, s, h, "a", "alice")
	if out := request(t, back, "portal:close", "close", nil); out["success"] != true {
		t.Fatal(out)
	}
	if id := deletedID(t, bob); id != portal["id"] {
		t.Fatalf("消えたもの: %s", id)
	}
}

// frozenPortalRoom は alice がポータルを置いた部屋を凍結し、引っ越しの中身を返す。
func frozenPortalRoom(t *testing.T, lifetime time.Duration) (*Room, *peer, *handoffSnapshot, string) {
	t.Helper()
	r, err := newRoom(definition("p"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { r.close(false) })
	r.deadline = time.Now().Add(time.Hour)
	r.portalLifetime = lifetime
	p := testPeer("alice")
	r.members["alice"] = &member{session: p, peer: p, user: Object{"id": "alice", "name": "alice"}}
	r.handle(p, Frame{Event: "portal:open", ID: "open", Data: encoded(portalAt("next", 0, 0))})
	created := <-p.out
	if out, _ := object((<-p.out).Data); created.Event != "entity:created" || out["success"] != true {
		t.Fatalf("open: %s %v", created.Event, out)
	}
	id := str(entityOf(t, created)["id"])
	h, ok := r.freeze()
	if !ok {
		t.Fatal("freeze")
	}
	return r, p, h, id
}

func TestPortalExpiryFollowsTheHandoff(t *testing.T) {
	r, _, h, id := frozenPortalRoom(t, 100*time.Millisecond)
	moved, err := restoreRoom(*h)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { moved.close(false) })
	if got := entityIDs(moved); !slices.Equal(got, []string{id}) {
		t.Fatalf("移ったもの: %v", got)
	}
	// 準備だけの部屋（まだ owner ではない）は消さない
	moved.mu.Lock()
	armed := moved.portalTimer != nil
	moved.mu.Unlock()
	if armed {
		t.Fatal("確定の前にタイマーを張った")
	}
	moved.deadline = time.Now().Add(time.Hour)
	moved.arrive(20*time.Millisecond, 0)
	eventually(t, "引っ越し先で期限が来ても消えない", func() bool { return len(entityIDs(moved)) == 0 })
	// 元の部屋は凍結のまま（引っ越しが済んだ部屋の状態を変えない）
	if got := entityIDs(r); !slices.Equal(got, []string{id}) {
		t.Fatalf("凍結した部屋が変わった: %v", got)
	}
}

func TestPortalExpiryResumesAfterAnAbortedHandoff(t *testing.T) {
	r, p, _, id := frozenPortalRoom(t, 50*time.Millisecond)
	time.Sleep(150 * time.Millisecond)
	if got := entityIDs(r); !slices.Equal(got, []string{id}) {
		t.Fatalf("凍結の間に消えた: %v", got)
	}
	r.thaw()
	select {
	case f := <-p.out:
		if f.Event != "entity:deleted" || string(f.Data) != `"`+id+`"` {
			t.Fatalf("届いたもの: %s %s", f.Event, f.Data)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("取りやめたあとも消えない")
	}
	if len(entityIDs(r)) != 0 {
		t.Fatal("消えていない")
	}
}

// backend（packages/backend/src/services/instances/roomPortalGrantToken.test.ts）と同じ例。どちらかだけを変えると、
// backend の出した許可をここで断る。
func TestPortalGrantVectors(t *testing.T) {
	key := portalGrantKey(Config{AdminToken: "ubichill-test-admin-token-0123456789abcdef"})
	vectors := []struct {
		grant, room, user string
		exp               int64
	}{
		{"eyJyb29tIjoiVjFTdEdYUjhfWjVqZEhpNkItbXlUIiwidXNlcklkIjoidXNlci1heWEiLCJleHAiOjE3NjcyMjU2MDB9.vLWRgNDNpDDeOdjSBSwMLBAv5l1sWai3LJHh2kZB_LE", "V1StGXR8_Z5jdHi6B-myT", "user-aya", 1767225600},
		{"eyJyb29tIjoiYWJjQFJvb20uRXhhbXBsZTo4NDQzIiwidXNlcklkIjoidXNlci1ib2IiLCJleHAiOjE3NjcyMjU2NjB9.RRPcv5-WHizWZK4vTXFc2DbHAVN_rz9wDcai_SO2RkY", "abc@Room.Example:8443", "user-bob", 1767225660},
	}
	for _, v := range vectors {
		before := time.Unix(v.exp-1, 0)
		if err := verifyPortalGrant(key, v.grant, v.room, v.user, before); err != nil {
			t.Fatalf("%s: %v", v.room, err)
		}
		if got := signGrant(key, portalGrant{Room: v.room, UserID: v.user, Exp: v.exp}); got != v.grant {
			t.Fatalf("同じ中身から別の許可になった:\n got %s\nwant %s", got, v.grant)
		}
		rejected := map[string]error{
			"期限ちょうど":     verifyPortalGrant(key, v.grant, v.room, v.user, time.Unix(v.exp, 0)),
			"別の住所":       verifyPortalGrant(key, v.grant, v.room+"x", v.user, before),
			"住所の大文字小文字":  verifyPortalGrant(key, v.grant, strings.ToLower(v.room), v.user, before),
			"別の人":        verifyPortalGrant(key, v.grant, v.room, v.user+"x", before),
			"別の管理トークンの鍵": verifyPortalGrant(portalGrantKey(Config{AdminToken: strings.Repeat("b", 32)}), v.grant, v.room, v.user, before),
			"チケットの鍵":     verifyPortalGrant(ticketKey(Config{AdminToken: "ubichill-test-admin-token-0123456789abcdef"}), v.grant, v.room, v.user, before),
			"署名の書き換え":    verifyPortalGrant(key, v.grant[:len(v.grant)-2]+"AA", v.room, v.user, before),
			"署名が無い":      verifyPortalGrant(key, strings.Split(v.grant, ".")[0], v.room, v.user, before),
			"空":          verifyPortalGrant(key, "", v.room, v.user, before),
			"鍵が無い":       verifyPortalGrant(nil, v.grant, v.room, v.user, before),
		}
		for name, err := range rejected {
			if err == nil {
				t.Errorf("%s / %s: 通した", v.room, name)
			}
		}
	}
	// 中身を書き換えると署名が合わない（期限を延ばす）
	forged := base64.RawURLEncoding.EncodeToString(encoded(portalGrant{"V1StGXR8_Z5jdHi6B-myT", "user-aya", 1867225600}))
	if verifyPortalGrant(key, forged+"."+strings.Split(vectors[0].grant, ".")[1], vectors[0].room, vectors[0].user, time.Unix(1767225600, 0)) == nil {
		t.Fatal("期限を延ばした許可を通した")
	}
}

// 管理トークンのある運用（backend がいる）では、portal:open に本人・その住所への許可が要る。
func TestPortalOpenRequiresGrant(t *testing.T) {
	s, h := start(t, false)
	alice := connect(t, s, h, "a", "alice")
	bob := connect(t, s, h, "a", "bob")
	expired := signGrant(testGrantKey, portalGrant{Room: "abc", UserID: "alice", Exp: time.Now().Add(-time.Second).Unix()})
	cases := map[string]Object{
		"許可が無い":     portalAt("abc", 0, 0),
		"許可が文字列でない": {"room": "abc", "x": float64(0), "y": float64(0), "grant": float64(1)},
		"ほかの人の許可":   {"room": "abc", "x": float64(0), "y": float64(0), "grant": grantFor("bob", "abc")},
		"ほかの住所の許可":  {"room": "abc", "x": float64(0), "y": float64(0), "grant": grantFor("alice", "abd")},
		"期限切れ":      {"room": "abc", "x": float64(0), "y": float64(0), "grant": expired},
		"長すぎる":      {"room": "abc", "x": float64(0), "y": float64(0), "grant": grantFor("alice", "abc") + strings.Repeat("A", maxPortalGrantLength)},
	}
	for name, payload := range cases {
		out := request(t, alice, "portal:open", "no-"+newID(), payload)
		if out["success"] != false || out["error"] != errPortalGrant.Error() {
			t.Errorf("%s: %v", name, out)
		}
	}
	expectNone(t, bob, "entity:created")
	if n := len(roomPortalsIn(s.room("a"))); n != 0 {
		t.Fatalf("許可なしで置かれた: %d", n)
	}
	// 断った要求は間隔を数えないので、すぐ許可付きで置ける
	created := openPortal(t, alice, "ok", portalBy("alice", "abc", 0, 0))
	if data, _ := created["data"].(map[string]any); data["grant"] != nil {
		t.Fatalf("許可を Entity に残した: %v", data)
	}
	receive(t, bob, "entity:created")
}

// 管理トークンの無い単体モード（backend が無い）は、許可を出す人がいないので求めない。
func TestPortalOpenStandaloneNeedsNoGrant(t *testing.T) {
	s := New(Config{Guests: true, Grace: 20 * time.Millisecond})
	if _, err := s.Provision(definition("a")); err != nil {
		t.Fatal(err)
	}
	h := httptest.NewServer(s.Handler())
	t.Cleanup(func() { s.Close(); h.Close() })
	alice := connect(t, s, h, "a", "alice")
	openPortal(t, alice, "open", portalAt("abc", 0, 0))
}
