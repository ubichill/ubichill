package runtime

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

// joinAs enters room a with a ticket and the given user object, returning the connection and the join reply.
func joinAs(t *testing.T, s *Server, url string, tk ticket, user Object) (*websocket.Conn, Object) {
	t.Helper()
	c, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(url, "http")+"/realtime/v1/ws", nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = c.Close() })
	_ = c.WriteJSON(Frame{Event: "world:join", ID: "join", Data: encoded(Object{"instanceId": tk.Instance, "token": s.sign(tk), "user": user})})
	out, _ := object(receive(t, c, "join").Data)
	return c, out
}

func TestJoinUsesVouchedNameAndDropsUnknownFields(t *testing.T) {
	s, h := start(t, false)
	watcher := connect(t, s, h, "a", "watcher")
	tk := ticket{"a", "mallory", time.Now().Add(time.Minute).Unix(), "member", "Mallory"}
	_, out := joinAs(t, s, h.URL, tk, Object{
		"name":      "Ubichill",
		"status":    "online",
		"position":  Object{"x": 0, "y": 0},
		"avatarUrl": "https://attacker.example/track.png",
		"cursorUrl": "https://attacker.example/track.png",
		"isAdmin":   true,
	})
	if out["success"] != true {
		t.Fatalf("join: %v", out)
	}
	var joined Object
	if err := json.Unmarshal(receive(t, watcher, "user:joined").Data, &joined); err != nil {
		t.Fatal(err)
	}
	if joined["name"] != "Mallory" {
		t.Fatalf("client chose its own name: %v", joined["name"])
	}
	for _, key := range []string{"avatarUrl", "cursorUrl", "isAdmin"} {
		if _, exists := joined[key]; exists {
			t.Fatalf("%s was broadcast to other participants: %v", key, joined)
		}
	}
}

func TestGuestKeepsClientName(t *testing.T) {
	s, h := start(t, true)
	tk := ticket{"a", "guest:x", time.Now().Add(time.Minute).Unix(), "guest", ""}
	c, out := joinAs(t, s, h.URL, tk, Object{"name": "Visitor", "status": "online", "position": Object{"x": 0, "y": 0}})
	if out["success"] != true {
		t.Fatalf("join: %v", out)
	}
	var users []Object
	_ = json.Unmarshal(receive(t, c, "users:update").Data, &users)
	if len(users) != 1 || users[0]["name"] != "Visitor" {
		t.Fatalf("users: %v", users)
	}
}

func TestTicketEndpointCarriesName(t *testing.T) {
	s, h := start(t, false)
	code, grant := call(t, h, "POST", "/instances/a/tickets", Object{"userId": "alice", "name": "Alice"}, true)
	if code != 200 {
		t.Fatal(code)
	}
	tk, err := s.verify(str(grant["token"]), "a")
	if err != nil || tk.Name != "Alice" {
		t.Fatalf("ticket: %+v %v", tk, err)
	}
	code, _ = call(t, h, "POST", "/instances/a/tickets", Object{"userId": "alice", "name": strings.Repeat("あ", 31)}, true)
	if code != 400 {
		t.Fatalf("overlong name accepted: %d", code)
	}
	code, _ = call(t, h, "POST", "/instances/a/tickets", Object{"userId": "alice", "name": "   "}, true)
	if code != 400 {
		t.Fatalf("blank name accepted: %d", code)
	}
}

func TestOneMemberCannotLockTheWholeWorld(t *testing.T) {
	s, h := start(t, false)
	alice := connect(t, s, h, "a", "alice")
	bob := connect(t, s, h, "a", "bob")
	ids := make([]string, maxLocksPerMember+1)
	for i := range ids {
		ids[i] = createEntity(t, bob, Object{})
	}
	for i, id := range ids[:maxLocksPerMember] {
		out := request(t, alice, "entity:patch", "lock-"+id, Object{"entityId": id, "patch": Object{"lockedBy": "alice"}})
		if out["success"] != true {
			t.Fatalf("lock %d: %v", i, out)
		}
	}
	out := request(t, alice, "entity:patch", "lock-over", Object{"entityId": ids[maxLocksPerMember], "patch": Object{"lockedBy": "alice"}})
	if out["success"] == true {
		t.Fatal("member locked more entities than allowed")
	}
	// Patching something already held is not a new lock.
	out = request(t, alice, "entity:patch", "relock", Object{"entityId": ids[0], "patch": Object{"lockedBy": "alice", "transform": Object{"x": float64(5)}}})
	if out["success"] != true {
		t.Fatalf("re-patching a held entity: %v", out)
	}
	// Releasing frees a slot.
	request(t, alice, "entity:patch", "release", Object{"entityId": ids[0], "patch": Object{"lockedBy": nil}})
	out = request(t, alice, "entity:patch", "lock-after", Object{"entityId": ids[maxLocksPerMember], "patch": Object{"lockedBy": "alice"}})
	if out["success"] != true {
		t.Fatalf("lock after release: %v", out)
	}
}

func TestRoomStateIsBounded(t *testing.T) {
	s, h := start(t, false)
	alice := connect(t, s, h, "a", "alice")
	small := createEntity(t, alice, Object{})
	r := s.room("a")
	r.mu.Lock()
	r.bytes = maxRoomBytes - 100
	r.mu.Unlock()
	out := request(t, alice, "entity:create", "big", Object{"type": "pen:stroke", "transform": fullTransform(), "data": Object{"blob": strings.Repeat("x", 1000)}})
	if out["success"] == true {
		t.Fatal("room grew past its limit")
	}
	out = request(t, alice, "entity:patch", "grow", Object{"entityId": small, "patch": Object{"data": Object{"blob": strings.Repeat("x", 1000)}}})
	if out["success"] == true {
		t.Fatal("patch grew the room past its limit")
	}
	// Deleting frees space for new entities.
	request(t, alice, "entity:delete", "del", small)
	r.mu.Lock()
	r.bytes -= 10000
	r.mu.Unlock()
	if out := request(t, alice, "entity:create", "fits", Object{"type": "pen:stroke", "transform": fullTransform(), "data": Object{}}); out["success"] != true {
		t.Fatalf("create after freeing space: %v", out)
	}
}

func TestRoomBytesTrackPutsAndDrops(t *testing.T) {
	s, h := start(t, false)
	alice := connect(t, s, h, "a", "alice")
	r := s.room("a")
	r.mu.Lock()
	before := r.bytes
	r.mu.Unlock()
	id := createEntity(t, alice, Object{"blob": strings.Repeat("x", 500)})
	request(t, alice, "entity:patch", "p", Object{"entityId": id, "patch": Object{"data": Object{"blob": "y"}}})
	request(t, alice, "entity:delete", "d", id)
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.bytes != before {
		t.Fatalf("bytes drifted: before=%d after=%d", before, r.bytes)
	}
}
