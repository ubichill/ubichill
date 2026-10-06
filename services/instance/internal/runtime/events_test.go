package runtime

import (
	"encoding/json"
	"math"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func fullTransform() Object {
	return Object{"x": float64(0), "y": float64(0), "z": float64(0), "w": float64(10), "h": float64(10), "scale": float64(1), "rotation": float64(0)}
}
func request(t *testing.T, c *websocket.Conn, event, id string, data any) Object {
	t.Helper()
	if err := c.WriteJSON(Frame{Event: event, ID: id, Data: encoded(data)}); err != nil {
		t.Fatal(err)
	}
	out, _ := object(receive(t, c, id).Data)
	return out
}
func createEntity(t *testing.T, c *websocket.Conn, data Object) string {
	t.Helper()
	out := request(t, c, "entity:create", "create-"+newID(), Object{"type": "pen:stroke", "transform": fullTransform(), "data": data})
	if out["success"] != true {
		t.Fatalf("create: %v", out)
	}
	return str(out["entity"].(map[string]any)["id"])
}
func entityIn(s *Server, room, id string) Object {
	r := s.room(room)
	r.mu.Lock()
	defer r.mu.Unlock()
	return clone(r.entities[id])
}
func putEntity(s *Server, room string, e Object) {
	r := s.room(room)
	r.mu.Lock()
	defer r.mu.Unlock()
	r.put(str(e["id"]), e)
}

// expectNone proves event was not delivered before a request issued afterwards was answered.
func expectNone(t *testing.T, c *websocket.Conn, event string) {
	t.Helper()
	id := "barrier-" + newID()
	if err := c.WriteJSON(Frame{Event: "media:timeline:get", ID: id, Data: encoded(Object{"sessionId": "barrier"})}); err != nil {
		t.Fatal(err)
	}
	_ = c.SetReadDeadline(time.Now().Add(2 * time.Second))
	for {
		var f Frame
		if err := c.ReadJSON(&f); err != nil {
			t.Fatal(err)
		}
		if f.Event == event {
			t.Fatalf("unexpected %s: %s", event, f.Data)
		}
		if f.ReplyTo == id {
			return
		}
	}
}

func TestEntityCreateRejectsInvalidInput(t *testing.T) {
	s, h := start(t, false)
	alice := connect(t, s, h, "a", "alice")
	valid := func(overrides Object) Object {
		e := Object{"type": "pen:stroke", "transform": fullTransform(), "data": Object{}}
		for k, v := range overrides {
			e[k] = v
		}
		return e
	}
	scaled := fullTransform()
	scaled["scale"] = float64(0)
	far := fullTransform()
	far["x"] = 1e8
	partial := fullTransform()
	delete(partial, "rotation")
	extra := fullTransform()
	extra["skew"] = float64(1)
	cases := map[string]Object{
		"core type":            valid(Object{"type": "core:Collider"}),
		"reserved entity type": valid(Object{"type": "__entity__"}),
		"type without scope":   valid(Object{"type": "stroke"}),
		"type with spaces":     valid(Object{"type": "pen:bad type"}),
		"data array":           valid(Object{"data": []any{}}),
		"data missing":         {"type": "pen:stroke", "transform": fullTransform()},
		"transform missing":    {"type": "pen:stroke", "data": Object{}},
		"transform partial":    valid(Object{"transform": partial}),
		"transform extra key":  valid(Object{"transform": extra}),
		"scale zero":           valid(Object{"transform": scaled}),
		"position too far":     valid(Object{"transform": far}),
		"empty entityId":       valid(Object{"entityId": ""}),
		"long parentEntityId":  valid(Object{"parentEntityId": strings.Repeat("p", 201)}),
		"numeric entityId":     valid(Object{"entityId": float64(1)}),
		"oversized data":       valid(Object{"data": Object{"blob": strings.Repeat("x", 65536)}}),
	}
	for name, payload := range cases {
		out := request(t, alice, "entity:create", "c-"+strings.ReplaceAll(name, " ", "-"), payload)
		if out["success"] != false {
			t.Errorf("%s: accepted %v", name, out)
		}
	}
	r := s.room("a")
	r.mu.Lock()
	count := len(r.entities)
	r.mu.Unlock()
	if count != 0 {
		t.Fatalf("rejected creates changed state: %d entities", count)
	}
	// Without a request ID the server cannot return the generated entity.
	_ = alice.WriteJSON(Frame{Event: "entity:create", Data: encoded(valid(nil))})
	var message string
	_ = json.Unmarshal(receive(t, alice, "error").Data, &message)
	if message == "" {
		t.Fatal("missing request ID was not reported")
	}
}

func TestEntityPatchRules(t *testing.T) {
	s, h := start(t, false)
	alice := connect(t, s, h, "a", "alice")
	bob := connect(t, s, h, "a", "bob")
	id := createEntity(t, alice, Object{"a": float64(1), "nested": Object{"x": float64(1)}})
	receive(t, bob, "entity:created")

	for _, key := range []string{"id", "type", "entityId", "parentEntityId"} {
		out := request(t, alice, "entity:patch", "immutable-"+key, Object{"entityId": id, "patch": Object{key: "changed", "data": Object{"a": float64(9)}}})
		if out["success"] != false {
			t.Fatalf("%s was mutable", key)
		}
	}
	if e := entityIn(s, "a", id); e["type"] != "pen:stroke" || e["data"].(map[string]any)["a"] != float64(1) {
		t.Fatalf("rejected patch partially applied: %v", e)
	}

	out := request(t, alice, "entity:patch", "merge", Object{"entityId": id, "patch": Object{
		"ownerId":   "bob",
		"data":      Object{"b": float64(2), "nested": Object{"y": float64(2)}},
		"transform": Object{"x": float64(5)},
	}})
	if out["success"] != true {
		t.Fatalf("merge: %v", out)
	}
	patched, _ := object(receive(t, bob, "entity:patched").Data)
	if _, leaked := patched["patch"].(map[string]any)["ownerId"]; leaked {
		t.Fatal("ownerId was relayed")
	}
	e := entityIn(s, "a", id)
	data := e["data"].(map[string]any)
	tr := e["transform"].(map[string]any)
	if e["ownerId"] != "alice" {
		t.Fatal("ownerId changed by patch")
	}
	if data["a"] != float64(1) || data["b"] != float64(2) {
		t.Fatalf("data is not shallow-merged: %v", data)
	}
	if nested := data["nested"].(map[string]any); nested["x"] != nil || nested["y"] != float64(2) {
		t.Fatalf("nested data must be replaced, not deep-merged: %v", nested)
	}
	if tr["x"] != float64(5) || tr["w"] != float64(10) {
		t.Fatalf("transform is not merged: %v", tr)
	}

	out = request(t, alice, "entity:patch", "lock", Object{"entityId": id, "patch": Object{"lockedBy": "bob"}})
	if out["success"] != true || entityIn(s, "a", id)["lockedBy"] != "alice" {
		t.Fatal("lock must be taken by the sender, not the requested user")
	}
	receive(t, bob, "entity:patched")
	if out := request(t, bob, "entity:patch", "locked", Object{"entityId": id, "patch": Object{"data": Object{"c": float64(3)}}}); out["success"] != false {
		t.Fatal("patched an entity locked by another user")
	}
	if out := request(t, bob, "entity:patch", "steal", Object{"entityId": id, "patch": Object{"lockedBy": nil}}); out["success"] != false {
		t.Fatal("released another user's lock")
	}
	if out := request(t, alice, "entity:patch", "release", Object{"entityId": id, "patch": Object{"lockedBy": nil}}); out["success"] != true {
		t.Fatal("owner could not release lock")
	}
	receive(t, bob, "entity:patched")
	if out := request(t, bob, "entity:patch", "after-release", Object{"entityId": id, "patch": Object{"data": Object{"c": float64(3)}}}); out["success"] != true {
		t.Fatal("released lock still blocks others")
	}

	for name, payload := range map[string]Object{
		"missing entity":    {"entityId": "missing", "patch": Object{"data": Object{}}},
		"invalid transform": {"entityId": id, "patch": Object{"transform": Object{"x": "1"}}},
		"unknown transform": {"entityId": id, "patch": Object{"transform": Object{"skew": float64(1)}}},
		"data not object":   {"entityId": id, "patch": Object{"data": "x"}},
		"patch not object":  {"entityId": id, "patch": "x"},
	} {
		if out := request(t, alice, "entity:patch", "bad-"+strings.ReplaceAll(name, " ", "-"), payload); out["success"] != false {
			t.Errorf("%s: accepted", name)
		}
	}
	// Each patch is small, but the merged entity must stay bounded.
	for i := range 2 {
		out = request(t, alice, "entity:patch", "grow-"+string(rune('a'+i)), Object{"entityId": id, "patch": Object{"data": Object{string(rune('a'+i)) + "blob": strings.Repeat("x", 40000)}}})
	}
	if out["success"] != false {
		t.Fatal("entity grew past the size limit")
	}
}

func TestEntityDeleteRules(t *testing.T) {
	s, h := start(t, false)
	alice := connect(t, s, h, "a", "alice")
	bob := connect(t, s, h, "a", "bob")
	putEntity(s, "a", Object{"id": "shared", "type": "pen:stroke", "ownerId": nil, "lockedBy": nil, "transform": fullTransform(), "data": Object{}})
	putEntity(s, "a", Object{"id": "held", "type": "pen:stroke", "ownerId": nil, "lockedBy": "alice", "transform": fullTransform(), "data": Object{}})
	own := createEntity(t, alice, Object{})
	receive(t, bob, "entity:created")

	if out := request(t, bob, "entity:delete", "held", "held"); out["success"] != false {
		t.Fatal("deleted an entity locked by another user")
	}
	if out := request(t, bob, "entity:delete", "missing", "missing"); out["success"] != false {
		t.Fatal("deleted a missing entity")
	}
	if out := request(t, bob, "entity:delete", "not-string", Object{"id": own}); out["success"] != false {
		t.Fatal("accepted a non-string id")
	}
	if out := request(t, bob, "entity:delete", "shared", "shared"); out["success"] != true {
		t.Fatal("unowned entity should be deletable by anyone")
	}
	receive(t, alice, "entity:deleted")
	if out := request(t, alice, "entity:delete", "own", own); out["success"] != true {
		t.Fatal("owner could not delete")
	}
	var deleted string
	_ = json.Unmarshal(receive(t, bob, "entity:deleted").Data, &deleted)
	if deleted != own || entityIn(s, "a", own) != nil {
		t.Fatal("delete was not applied")
	}
}

func TestEphemeralCursorAndStatus(t *testing.T) {
	s, h := start(t, false)
	alice := connect(t, s, h, "a", "alice")
	bob := connect(t, s, h, "a", "bob")
	id := createEntity(t, alice, Object{})
	receive(t, bob, "entity:created")

	if out := request(t, alice, "entity:ephemeral", "eph-missing", Object{"entityId": "missing", "data": Object{}}); out["success"] != false {
		t.Fatal("ephemeral for missing entity accepted")
	}
	if out := request(t, alice, "entity:ephemeral", "eph-big", Object{"entityId": id, "data": strings.Repeat("x", 32768)}); out["success"] != false {
		t.Fatal("oversized ephemeral accepted")
	}
	_ = alice.WriteJSON(Frame{Event: "entity:ephemeral", Data: encoded(Object{"entityId": id, "data": Object{"t": float64(1)}})})
	ephemeral, _ := object(receive(t, bob, "entity:ephemeral").Data)
	if ephemeral["entityId"] != id {
		t.Fatalf("ephemeral not relayed: %v", ephemeral)
	}

	_ = alice.WriteJSON(Frame{Event: "cursor:move", Data: encoded(Object{"position": Object{"x": float64(3), "y": float64(4)}, "heldEntityId": id})})
	moved, _ := object(receive(t, bob, "cursor:moved").Data)
	if moved["userId"] != "alice" || moved["heldEntityId"] != id || moved["position"].(map[string]any)["x"] != float64(3) {
		t.Fatalf("cursor not relayed: %v", moved)
	}
	if out := request(t, alice, "cursor:move", "far", Object{"position": Object{"x": 1e8, "y": float64(0)}}); out["success"] != false {
		t.Fatal("out-of-range cursor accepted")
	}
	if out := request(t, alice, "status:update", "bad-status", "sleeping"); out["success"] != false {
		t.Fatal("unknown status accepted")
	}
	_ = alice.WriteJSON(Frame{Event: "status:update", Data: encoded("busy")})
	changed, _ := object(receive(t, bob, "status:changed").Data)
	if changed["userId"] != "alice" || changed["status"] != "busy" {
		t.Fatalf("status not relayed: %v", changed)
	}
	// A later joiner sees the stored cursor and status.
	_ = connect(t, s, h, "a", "carol")
	r := s.room("a")
	r.mu.Lock()
	user := clone(r.members["alice"].user)
	r.mu.Unlock()
	if user["status"] != "busy" || user["position"].(map[string]any)["y"] != float64(4) {
		t.Fatalf("user state not stored: %v", user)
	}
}

func TestMediaTimelineTransitions(t *testing.T) {
	s, _ := start(t, false)
	r := s.room("a")
	r.mu.Lock()
	defer r.mu.Unlock()
	update := func(v Object) (Object, error) { return r.media(v, "alice") }
	if _, err := update(Object{"sessionId": "v", "mediaId": "one", "action": "play"}); err == nil {
		t.Fatal("play before load accepted")
	}
	if _, err := update(Object{"sessionId": "v", "mediaId": "one", "action": "load", "duration": float64(10), "playbackRate": float64(1.5)}); err != nil {
		t.Fatal(err)
	}
	playing, err := update(Object{"sessionId": "v", "mediaId": "one", "action": "play"})
	if err != nil || playing["phase"] != "playing" || playing["revision"] != float64(2) {
		t.Fatalf("play: %v %v", playing, err)
	}
	r.timelines["v"]["anchorServerTime"] = num(playing["anchorServerTime"]) - 2000
	paused, _ := update(Object{"sessionId": "v", "mediaId": "one", "action": "pause"})
	if got := num(paused["anchorTime"]); math.Abs(got-3) > 0.1 {
		t.Fatalf("position after 2s at 1.5x = %v, want 3", got)
	}
	if paused["playbackRate"] != float64(1.5) {
		t.Fatal("playback rate was not carried over")
	}
	_, _ = update(Object{"sessionId": "v", "mediaId": "one", "action": "play"})
	r.timelines["v"]["anchorServerTime"] = num(r.timelines["v"]["anchorServerTime"]) - 60000
	clamped, _ := update(Object{"sessionId": "v", "mediaId": "one", "action": "pause"})
	if clamped["anchorTime"] != float64(10) {
		t.Fatalf("position must stop at duration: %v", clamped["anchorTime"])
	}
	ended, _ := update(Object{"sessionId": "v", "mediaId": "one", "action": "ended"})
	if ended["phase"] != "ended" || ended["anchorTime"] != float64(10) {
		t.Fatalf("ended: %v", ended)
	}
	meta, _ := update(Object{"sessionId": "v", "mediaId": "one", "action": "metadata", "duration": float64(20)})
	if meta["duration"] != float64(20) {
		t.Fatalf("metadata: %v", meta)
	}
	revision := num(meta["revision"])
	for name, v := range map[string]Object{
		"other media":         {"sessionId": "v", "mediaId": "two", "action": "play"},
		"fractional revision": {"sessionId": "v", "mediaId": "one", "action": "play", "expectedRevision": revision + 0.5},
		"negative position":   {"sessionId": "v", "mediaId": "one", "action": "seek", "position": float64(-1)},
		"zero rate":           {"sessionId": "v", "mediaId": "one", "action": "play", "playbackRate": float64(0)},
		"too fast":            {"sessionId": "v", "mediaId": "one", "action": "play", "playbackRate": float64(5)},
		"string position":     {"sessionId": "v", "mediaId": "one", "action": "seek", "position": "1"},
		"unknown action":      {"sessionId": "v", "mediaId": "one", "action": "rewind"},
		"missing session":     {"mediaId": "one", "action": "load"},
		"long session":        {"sessionId": strings.Repeat("s", 257), "mediaId": "one", "action": "load"},
		"nil payload":         nil,
	} {
		if _, err := update(v); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
	if num(r.timelines["v"]["revision"]) != revision {
		t.Fatal("rejected updates changed the timeline")
	}
	reloaded, _ := update(Object{"sessionId": "v", "mediaId": "two", "action": "load"})
	if reloaded["phase"] != "paused" || reloaded["anchorTime"] != float64(0) || num(reloaded["revision"]) != revision+1 {
		t.Fatalf("loading other media must restart at a new revision: %v", reloaded)
	}
}

func TestMediaConflictReturnsCurrentTimeline(t *testing.T) {
	s, h := start(t, false)
	alice := connect(t, s, h, "a", "alice")
	bob := connect(t, s, h, "a", "bob")
	loaded := request(t, alice, "media:timeline:update", "load", Object{"sessionId": "v", "mediaId": "one", "action": "load"})
	if loaded["success"] != true {
		t.Fatal(loaded)
	}
	receive(t, bob, "media:timeline")
	_ = request(t, bob, "media:timeline:update", "play", Object{"sessionId": "v", "mediaId": "one", "action": "play", "expectedRevision": float64(1)})
	stale := request(t, alice, "media:timeline:update", "stale", Object{"sessionId": "v", "mediaId": "one", "action": "pause", "expectedRevision": float64(1)})
	current, _ := stale["timeline"].(map[string]any)
	if stale["success"] != false || current == nil || current["revision"] != float64(2) || current["phase"] != "playing" {
		t.Fatalf("conflict must return the authoritative timeline: %v", stale)
	}
	if out := request(t, alice, "media:timeline:update", "null", nil); out["success"] != false {
		t.Fatal("null media update accepted")
	}
}

func TestMediaStateResponseStaysInRoom(t *testing.T) {
	s, h := start(t, false)
	alice := connect(t, s, h, "a", "alice")
	bob := connect(t, s, h, "a", "bob")
	other := connect(t, s, h, "b", "other")
	_ = bob.WriteJSON(Frame{Event: "media:state-request", Data: encoded(Object{})})
	asked, _ := object(receive(t, alice, "media:state-request").Data)
	s.admission.Lock()
	otherSocket := s.active["other"].id
	s.admission.Unlock()
	_ = alice.WriteJSON(Frame{Event: "media:state-response", Data: encoded(Object{"toSocketId": otherSocket, "state": "x"})})
	_ = alice.WriteJSON(Frame{Event: "media:state-response", Data: encoded(Object{"toSocketId": asked["fromSocketId"], "state": "y"})})
	response, _ := object(receive(t, bob, "media:state-response").Data)
	if response["state"] != "y" {
		t.Fatalf("response not delivered: %v", response)
	}
	if _, leaked := response["toSocketId"]; leaked {
		t.Fatal("routing field was relayed")
	}
	expectNone(t, other, "media:state-response")
}
