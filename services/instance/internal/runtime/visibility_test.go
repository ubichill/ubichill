package runtime

import (
	"encoding/json"
	"slices"
	"sync"
	"testing"
	"time"
)

func switchRoom() Definition {
	d := definition("v")
	entity := func(id, typ, entityID string, data Object) Object {
		return Object{"id": id, "type": typ, "entityId": entityID, "ownerId": nil, "lockedBy": nil, "transform": fullTransform(), "data": data}
	}
	d.Snapshot.Entities = []Object{
		entity("panel::0", "core:switch", "panel", Object{"targets": []any{"door", "ghost", "door", "lamp", 42}}),
		entity("door::0", "core:text", "door", Object{"text": "扉"}),
		entity("lamp::0", "core:image", "lamp", Object{}),
	}
	d.Snapshot.HiddenEntities = []string{"lamp"}
	return d
}

func hiddenOf(t *testing.T, f Frame) []string {
	t.Helper()
	var data struct {
		HiddenEntities []string `json:"hiddenEntities"`
	}
	if err := json.Unmarshal(f.Data, &data); err != nil || data.HiddenEntities == nil {
		t.Fatalf("entity:visibility: %s", f.Data)
	}
	return data.HiddenEntities
}

func TestSwitchTogglesTargetsForEveryone(t *testing.T) {
	s, h := start(t, false)
	if _, err := s.Provision(switchRoom()); err != nil {
		t.Fatal(err)
	}
	var clock sync.Mutex
	now := time.Unix(1000, 0)
	r := s.room("v")
	r.mu.Lock()
	r.now = func() time.Time { clock.Lock(); defer clock.Unlock(); return now }
	r.mu.Unlock()
	advance := func() { clock.Lock(); now = now.Add(switchInterval); clock.Unlock() }

	alice, snapshot := join(t, s, h, "v", "alice")
	if !slices.Equal(snapshot.HiddenEntities, []string{"lamp"}) {
		t.Fatalf("初めの見えない Entity: %v", snapshot.HiddenEntities)
	}
	bob, _ := join(t, s, h, "v", "bob")

	// 重なった対象は 1 回だけ、部屋に無い対象と文字列でない値は飛ばす
	if out := request(t, alice, "switch:press", "press-1", Object{"componentId": "panel::0"}); out["success"] != true {
		t.Fatalf("press: %v", out)
	}
	if got := hiddenOf(t, receive(t, bob, "entity:visibility")); !slices.Equal(got, []string{"door"}) {
		t.Fatalf("bob に届いた一覧: %v", got)
	}

	// 続けて押すのは断る（間隔は人ごと）
	if out := request(t, alice, "switch:press", "press-2", Object{"componentId": "panel::0"}); out["success"] != false {
		t.Fatalf("速すぎる押下を通した: %v", out)
	}
	// 押した本人にも届く（応答より前に）
	if err := bob.WriteJSON(Frame{Event: "switch:press", ID: "press-3", Data: encoded(Object{"componentId": "panel::0"})}); err != nil {
		t.Fatal(err)
	}
	if got := hiddenOf(t, receive(t, bob, "entity:visibility")); !slices.Equal(got, []string{"lamp"}) {
		t.Fatalf("bob 本人に届いた一覧: %v", got)
	}
	if reply, _ := object(receive(t, bob, "press-3").Data); reply["success"] != true {
		t.Fatalf("bob の押下: %v", reply)
	}
	if got := hiddenOf(t, receive(t, alice, "entity:visibility")); !slices.Equal(got, []string{"lamp"}) {
		t.Fatalf("2 回目の一覧: %v", got)
	}
	advance()
	request(t, alice, "switch:press", "press-4", Object{"componentId": "panel::0"})
	if got := hiddenOf(t, receive(t, bob, "entity:visibility")); !slices.Equal(got, []string{"door"}) {
		t.Fatalf("間隔の後の一覧: %v", got)
	}

	// スイッチでない Component・無い Component は断る
	advance()
	for _, id := range []string{"door::0", "nothing", ""} {
		if out := request(t, alice, "switch:press", "bad-"+id, Object{"componentId": id}); out["success"] != false {
			t.Fatalf("%q を押せた: %v", id, out)
		}
	}
	expectNone(t, bob, "entity:visibility")

	// 引っ越しの中身と、そこから作った部屋も見えない Entity を引き継ぐ
	handoff, ok := r.freeze()
	if !ok || !slices.Equal(handoff.Definition.Snapshot.HiddenEntities, []string{"door"}) {
		t.Fatalf("引っ越しの中身: %v", handoff)
	}
	moved, err := newRoom(handoff.Definition)
	if err != nil || !moved.hidden["door"] || len(moved.hidden) != 1 {
		t.Fatalf("引っ越し先の部屋: %v %v", moved, err)
	}
}

func TestSwitchWithNothingToChangeDoesNotBroadcast(t *testing.T) {
	s, h := start(t, false)
	d := switchRoom()
	d.Snapshot.Entities[0]["data"] = Object{"targets": []any{"ghost"}}
	if _, err := s.Provision(d); err != nil {
		t.Fatal(err)
	}
	alice := connect(t, s, h, "v", "alice")
	bob := connect(t, s, h, "v", "bob")
	if out := request(t, alice, "switch:press", "press", Object{"componentId": "panel::0"}); out["success"] != true {
		t.Fatalf("press: %v", out)
	}
	expectNone(t, bob, "entity:visibility")
}

func TestInvalidHiddenEntitiesAreRejected(t *testing.T) {
	for _, ids := range [][]string{{""}, {string(make([]byte, 201))}} {
		d := definition("x")
		d.Snapshot.HiddenEntities = ids
		if _, err := newRoom(d); err == nil {
			t.Fatalf("受け付けた: %q", ids)
		}
	}
	d := definition("x")
	d.Snapshot.HiddenEntities = make([]string, 10001)
	for i := range d.Snapshot.HiddenEntities {
		d.Snapshot.HiddenEntities[i] = "e"
	}
	if _, err := newRoom(d); err == nil {
		t.Fatal("多すぎる一覧を受け付けた")
	}
}
