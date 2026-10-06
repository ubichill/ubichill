package runtime

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func definition(id string) Definition {
	return Definition{ID: id, Name: id, MaxUsers: 3, Snapshot: Snapshot{Entities: []Object{}, Environment: Object{"backgroundColor": "#fff", "worldSize": Object{"width": 2000, "height": 1500}}}}
}
func start(t *testing.T, guests bool) (*Server, *httptest.Server) {
	t.Helper()
	s := New(Config{AdminToken: strings.Repeat("a", 32), Guests: guests, Grace: 20 * time.Millisecond})
	_, err := s.Provision(definition("a"))
	if err != nil {
		t.Fatal(err)
	}
	_, _ = s.Provision(definition("b"))
	httpServer := httptest.NewServer(s.Handler())
	t.Cleanup(func() { s.Close(); httpServer.Close() })
	return s, httpServer
}
func call(t *testing.T, h *httptest.Server, method, path string, body any, admin bool) (int, Object) {
	t.Helper()
	req, _ := http.NewRequest(method, h.URL+"/realtime/v1"+path, bytes.NewReader(encoded(body)))
	if admin {
		req.Header.Set("Authorization", "Bearer "+strings.Repeat("a", 32))
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	obj, _ := object(b)
	return res.StatusCode, obj
}
func receive(t *testing.T, c *websocket.Conn, event string) Frame {
	t.Helper()
	_ = c.SetReadDeadline(time.Now().Add(2 * time.Second))
	for {
		var f Frame
		if err := c.ReadJSON(&f); err != nil {
			t.Fatal(err)
		}
		if f.Event == event || f.ReplyTo == event {
			return f
		}
	}
}
func connect(t *testing.T, s *Server, h *httptest.Server, room, user string) *websocket.Conn {
	t.Helper()
	c, _ := join(t, s, h, room, user)
	return c
}
func join(t *testing.T, s *Server, h *httptest.Server, room, user string) (*websocket.Conn, Snapshot) {
	t.Helper()
	c, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(h.URL, "http")+"/realtime/v1/ws", nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = c.Close() })
	token := s.sign(ticket{room, user, time.Now().Add(time.Minute).Unix(), "member"})
	_ = c.WriteJSON(Frame{Event: "world:join", ID: "join", Data: encoded(Object{"instanceId": room, "token": token, "user": Object{"name": user, "status": "online", "position": Object{"x": 0, "y": 0}}})})
	f := receive(t, c, "join")
	var result Object
	_ = json.Unmarshal(f.Data, &result)
	if result["success"] != true {
		t.Fatalf("join: %s", f.Data)
	}
	var snapshot Snapshot
	if err := json.Unmarshal(receive(t, c, "world:snapshot").Data, &snapshot); err != nil {
		t.Fatal(err)
	}
	return c, snapshot
}
func TestGuestAndManagementBoundary(t *testing.T) {
	_, h := start(t, true)
	code, _ := call(t, h, "PUT", "/instances/c", definition("c"), false)
	if code != 401 {
		t.Fatal(code)
	}
	code, grant := call(t, h, "POST", "/instances/a/guest", Object{}, false)
	if code != 200 {
		t.Fatal(code)
	}
	_, resumed := call(t, h, "POST", "/instances/a/guest", Object{"resumeToken": grant["token"]}, false)
	if resumed["userId"] != grant["userId"] {
		t.Fatal("guest identity was lost")
	}
	_, other := call(t, h, "POST", "/instances/b/guest", Object{"resumeToken": grant["token"]}, false)
	if other["userId"] == grant["userId"] {
		t.Fatal("cross-room guest token accepted")
	}
	_, managed := start(t, false)
	code, _ = call(t, managed, "POST", "/instances/a/guest", Object{}, false)
	if code != 403 {
		t.Fatal(code)
	}
	code, _ = call(t, managed, "GET", "/instances/a", nil, false)
	if code != 401 {
		t.Fatal("private room metadata leaked")
	}
}
func TestTicketValidation(t *testing.T) {
	s, _ := start(t, false)
	valid := ticket{"a", "alice", time.Now().Add(time.Minute).Unix(), "member"}
	if _, err := s.verify(s.sign(valid), "a"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.verify(s.sign(valid), "b"); err == nil {
		t.Fatal("wrong room accepted")
	}
	if _, err := s.verify(s.sign(valid)+"x", "a"); err == nil {
		t.Fatal("tampering accepted")
	}
	valid.Expires = time.Now().Add(-time.Second).Unix()
	if _, err := s.verify(s.sign(valid), "a"); err == nil {
		t.Fatal("expired ticket accepted")
	}
}
func TestRoomIsolationAndLifecycle(t *testing.T) {
	s, h := start(t, false)
	alice := connect(t, s, h, "a", "alice")
	bob := connect(t, s, h, "a", "bob")
	other := connect(t, s, h, "b", "other")
	payload := Object{"type": "pen:stroke", "ownerId": "bob", "lockedBy": "bob", "data": Object{}, "transform": Object{"x": 0, "y": 0, "z": 0, "w": 1, "h": 1, "scale": 1, "rotation": 0}}
	_ = alice.WriteJSON(Frame{Event: "entity:create", ID: "create", Data: encoded(payload)})
	f := receive(t, alice, "create")
	out, _ := object(f.Data)
	e := out["entity"].(map[string]any)
	if e["ownerId"] != "alice" || e["lockedBy"] != nil {
		t.Fatal("identity spoofed")
	}
	id := str(e["id"])
	receive(t, bob, "entity:created")
	_ = bob.WriteJSON(Frame{Event: "entity:delete", ID: "delete", Data: encoded(id)})
	out, _ = object(receive(t, bob, "delete").Data)
	if out["success"] != false {
		t.Fatal("non-owner deleted entity")
	}
	_ = alice.WriteJSON(Frame{Event: "entity:patch", ID: "patch", Data: encoded(Object{"entityId": id, "patch": Object{"lockedBy": "bob"}})})
	receive(t, alice, "patch")
	receive(t, bob, "entity:patched")
	_ = bob.WriteJSON(Frame{Event: "entity:patch", ID: "patch-bob", Data: encoded(Object{"entityId": id, "patch": Object{"data": Object{"x": 1}}})})
	out, _ = object(receive(t, bob, "patch-bob").Data)
	if out["success"] != false {
		t.Fatal("lock bypass")
	}
	// A snapshot barrier proves no cross-room broadcast was queued before it.
	_ = other.WriteJSON(Frame{Event: "media:timeline:get", ID: "barrier", Data: encoded(Object{"sessionId": "video"})})
	var frame Frame
	_ = other.SetReadDeadline(time.Now().Add(time.Second))
	if err := other.ReadJSON(&frame); err != nil || frame.ReplyTo != "barrier" {
		t.Fatalf("cross-room message: %+v %v", frame, err)
	}
	// Reprovisioning a live or emptied room never resets its state.
	_, _ = s.Provision(definition("a"))
	r := s.room("a")
	r.mu.Lock()
	if len(r.entities) != 1 {
		t.Fatal("state reset")
	}
	r.mu.Unlock()
	_ = alice.Close()
	receive(t, bob, "entity:patched")
	receive(t, bob, "user:left")
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.entities[id]["lockedBy"] != nil {
		t.Fatal("lock leaked on disconnect")
	}
}
func TestFullRoomAndAtomicReaping(t *testing.T) {
	s, h := start(t, false)
	s.room("a").definition.MaxUsers = 1
	_ = connect(t, s, h, "a", "alice")
	code, _ := call(t, h, "DELETE", "/instances/a?emptyBefore=9999999999999", nil, true)
	if code != 409 {
		t.Fatal("active room deleted", code)
	}
	c, _, _ := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(h.URL, "http")+"/realtime/v1/ws", nil)
	defer c.Close()
	_ = c.WriteJSON(Frame{Event: "world:join", ID: "full", Data: encoded(Object{"instanceId": "a", "token": s.sign(ticket{"a", "bob", time.Now().Add(time.Minute).Unix(), "member"}), "user": Object{"name": "Bob", "position": Object{"x": 0, "y": 0}, "status": "online"}})})
	result, _ := object(receive(t, c, "full").Data)
	if result["success"] != false {
		t.Fatal("capacity bypass")
	}
}
func TestConcurrentCreationAndMediaRevision(t *testing.T) {
	s, _ := start(t, false)
	var wg sync.WaitGroup
	for range 20 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := s.Provision(definition("same"))
			if err != nil {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	r := s.room("same")
	r.mu.Lock()
	defer r.mu.Unlock()
	first, err := r.media(Object{"sessionId": "v", "mediaId": "one", "action": "load"}, "alice")
	if err != nil {
		t.Fatal(err)
	}
	again, _ := r.media(Object{"sessionId": "v", "mediaId": "one", "action": "load"}, "bob")
	if again["revision"] != first["revision"] {
		t.Fatal("load reset")
	}
	_, err = r.media(Object{"sessionId": "v", "mediaId": "one", "action": "play", "expectedRevision": float64(0)}, "bob")
	if err == nil {
		t.Fatal("stale revision accepted")
	}
	_, err = r.media(Object{"sessionId": "v", "mediaId": "one", "action": "seek", "position": float64(-1)}, "bob")
	if err == nil {
		t.Fatal("invalid seek accepted")
	}
}

func TestCloseCannotRaceWithReprovision(t *testing.T) {
	s, h := start(t, false)
	code, _ := call(t, h, "DELETE", "/instances/a?emptyBefore=9999999999999", nil, true)
	if code != 204 {
		t.Fatal(code)
	}
	if _, err := s.Provision(definition("a")); err == nil {
		t.Fatal("a concurrent join resurrected the closed instance")
	}
}

func TestSnapshotIncludesCoreAndImmutableFields(t *testing.T) {
	s, h := start(t, false)
	r := s.room("a")
	r.mu.Lock()
	r.entities["core"] = Object{"id": "core", "type": "core:Collider", "ownerId": nil, "lockedBy": nil, "data": Object{}, "transform": Object{"x": float64(0), "y": float64(0), "z": float64(0), "w": float64(1), "h": float64(1), "scale": float64(1), "rotation": float64(0)}}
	r.mu.Unlock()
	c := connect(t, s, h, "a", "alice")
	for _, frame := range []Frame{
		{Event: "entity:patch", ID: "patch", Data: encoded(Object{"entityId": "core", "patch": Object{"data": Object{"x": 1}}})},
		{Event: "entity:delete", ID: "delete", Data: encoded("core")},
		{Event: "entity:create", ID: "spoof", Data: encoded(Object{"id": "core", "type": "pen:stroke"})},
	} {
		if err := c.WriteJSON(frame); err != nil {
			t.Fatal(err)
		}
		reply, _ := object(receive(t, c, frame.ID).Data)
		if reply["success"] != false {
			t.Fatal("reserved entity mutated", frame.Event)
		}
	}
}

func TestReconnectToAnotherRoomReleasesOldMembership(t *testing.T) {
	s, h := start(t, false)
	// Long enough to inspect the transfer before the old grace timeout.
	s.config.Grace = time.Second
	first := connect(t, s, h, "a", "alice")
	_ = first.Close()
	deadline := time.Now().Add(time.Second)
	for {
		r := s.room("a")
		r.mu.Lock()
		m := r.members["alice"]
		disconnected := m != nil && m.peer == nil
		r.mu.Unlock()
		if disconnected {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("disconnect was not observed")
		}
		time.Sleep(time.Millisecond)
	}
	_ = connect(t, s, h, "b", "alice")
	if len(s.room("a").presence().MemberIDs) != 0 {
		t.Fatal("old room still owns participant during grace")
	}
	if len(s.room("b").presence().MemberIDs) != 1 {
		t.Fatal("new room lost participant")
	}
}
