package runtime

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"
)

func stateUpdate(key string, value any, expected any) Object {
	return Object{"key": key, "value": value, "expectedRevision": expected}
}

func entryOf(t *testing.T, reply Object) Object {
	t.Helper()
	e, _ := reply["entry"].(map[string]any)
	return e
}

func TestStateCompareAndSwap(t *testing.T) {
	s, h := start(t, false)
	fixed := time.UnixMilli(1_700_000_000_000)
	r := s.room("a")
	r.mu.Lock()
	r.now = func() time.Time { return fixed }
	r.mu.Unlock()
	alice := connect(t, s, h, "a", "alice")
	bob := connect(t, s, h, "a", "bob")
	carol := connect(t, s, h, "a", "carol")

	if got := request(t, alice, "state:get", "empty", Object{"key": "k"}); got["success"] != true || got["entry"] != nil || got["serverTime"] != float64(fixed.UnixMilli()) {
		t.Fatalf("missing key: %v", got)
	}
	created := request(t, alice, "state:update", "create", stateUpdate("k", Object{"n": 1}, 0))
	e := entryOf(t, created)
	if created["success"] != true || e["revision"] != float64(1) || e["updatedBy"] != "alice" || e["updatedAt"] != float64(fixed.UnixMilli()) || e["key"] != "k" {
		t.Fatalf("create: %v", created)
	}
	for _, c := range []struct {
		name string
		got  Frame
	}{{"bob", receive(t, bob, "state:changed")}, {"carol", receive(t, carol, "state:changed")}} {
		changed, _ := object(c.got.Data)
		if changed["revision"] != float64(1) || changed["value"].(map[string]any)["n"] != float64(1) {
			t.Fatalf("%s got %v", c.name, changed)
		}
	}
	// 書いた本人へは応答に同じ内容があるので配らない
	expectNone(t, alice, "state:changed")

	if out := request(t, bob, "state:update", "bob", stateUpdate("k", "bob", 1)); out["success"] != true || entryOf(t, out)["revision"] != float64(2) {
		t.Fatalf("bob: %v", out)
	}
	for name, expected := range map[string]float64{"stale": 1, "recreate": 0, "future": 3} {
		out := request(t, alice, "state:update", name, stateUpdate("k", "alice", expected))
		current := entryOf(t, out)
		if out["success"] != false || out["code"] != "conflict" || current["revision"] != float64(2) || current["value"] != "bob" || current["updatedBy"] != "bob" {
			t.Fatalf("%s must return the current entry: %v", name, out)
		}
	}
	got := entryOf(t, request(t, carol, "state:get", "after", Object{"key": "k"}))
	if got["revision"] != float64(2) || got["value"] != "bob" {
		t.Fatalf("rejected updates changed the entry: %v", got)
	}
}

func TestStateValueIsOpaque(t *testing.T) {
	s, h := start(t, false)
	alice := connect(t, s, h, "a", "alice")
	for i, value := range []string{`null`, `0`, `-1.5e3`, `"text"`, `[1,{"a":[]},null]`, `{"phase":"playing","nested":{"x":true}}`, `{ "spaced" :  [ 1 , 2 ] }`} {
		key := fmt.Sprint("v", i)
		raw := json.RawMessage(fmt.Sprintf(`{"key":%q,"value":%s,"expectedRevision":0}`, key, value))
		out := request(t, alice, "state:update", key, raw)
		if out["success"] != true {
			t.Fatalf("%s rejected: %v", value, out)
		}
		r := s.room("a")
		r.mu.Lock()
		stored := string(r.state[key].Value)
		r.mu.Unlock()
		if stored != strings.Join(strings.Fields(value), "") {
			t.Fatalf("stored %s for %s", stored, value)
		}
	}
}

func TestStateRejectsInvalidInput(t *testing.T) {
	s, h := start(t, false)
	alice := connect(t, s, h, "a", "alice")
	bob := connect(t, s, h, "a", "bob")
	if out := request(t, alice, "state:update", "seed", stateUpdate("k", 1, 0)); out["success"] != true {
		t.Fatal(out)
	}
	receive(t, bob, "state:changed")
	cases := map[string]any{
		"nil payload":          nil,
		"string payload":       "k",
		"missing key":          Object{"value": 1, "expectedRevision": 1},
		"empty key":            stateUpdate("", 1, 0),
		"numeric key":          Object{"key": 1, "value": 1, "expectedRevision": 0},
		"long key":             stateUpdate(strings.Repeat("k", maxStateKeyBytes+1), 1, 0),
		"missing value":        Object{"key": "k", "expectedRevision": 1},
		"missing revision":     Object{"key": "k", "value": 2},
		"null revision":        stateUpdate("k", 2, nil),
		"string revision":      stateUpdate("k", 2, "1"),
		"fractional revision":  stateUpdate("k", 2, 0.5),
		"negative revision":    stateUpdate("k", 2, -1),
		"huge revision":        stateUpdate("k", 2, 1e300),
		"value over the limit": stateUpdate("k", strings.Repeat("x", maxStateValueBytes-1), 1),
	}
	for name, data := range cases {
		out := request(t, alice, "state:update", name, data)
		if out["success"] != false || out["code"] != nil {
			t.Errorf("%s: %v", name, out)
		}
	}
	for name, data := range map[string]any{"nil": nil, "empty key": Object{"key": ""}, "long key": Object{"key": strings.Repeat("k", maxStateKeyBytes+1)}, "numeric key": Object{"key": 1}} {
		if out := request(t, alice, "state:get", "get "+name, data); out["success"] != false {
			t.Errorf("get %s: %v", name, out)
		}
	}
	expectNone(t, bob, "state:changed")
	got := entryOf(t, request(t, alice, "state:get", "after", Object{"key": "k"}))
	if got["revision"] != float64(1) || got["value"] != float64(1) {
		t.Fatalf("invalid updates changed the entry: %v", got)
	}
	// 上限ちょうど（引用符を含めて 32KiB）は通る
	if out := request(t, alice, "state:update", "edge", stateUpdate("k", strings.Repeat("x", maxStateValueBytes-2), 1)); out["success"] != true {
		t.Fatalf("value at the limit rejected: %v", out)
	}
}

func TestStateLimits(t *testing.T) {
	s, _ := start(t, false)
	r := s.room("a")
	r.mu.Lock()
	defer r.mu.Unlock()
	update := func(key string, value string, expected int) (*stateEntry, error) {
		return r.updateState(encoded(stateUpdate(key, value, expected)), "alice")
	}
	for i := range maxStateKeys {
		if _, err := update(fmt.Sprint("k", i), "v", 0); err != nil {
			t.Fatalf("key %d: %v", i, err)
		}
	}
	if _, err := update("one-more", "v", 0); !errors.Is(err, errStateFull) {
		t.Fatalf("key count limit: %v", err)
	}
	if _, err := update("k0", "changed", 1); err != nil {
		t.Fatalf("existing keys must stay writable at the key limit: %v", err)
	}

	r.state, r.stateBytes = map[string]*stateEntry{}, 0
	big := strings.Repeat("x", maxStateValueBytes-2)
	filled := 0
	for ; ; filled++ {
		if _, err := update(fmt.Sprint("big", filled), big, 0); err != nil {
			if !errors.Is(err, errStateFull) {
				t.Fatal(err)
			}
			break
		}
	}
	if filled == 0 || filled >= maxStateKeys || r.stateBytes > maxStateBytes {
		t.Fatalf("byte budget: filled %d keys, %d bytes", filled, r.stateBytes)
	}
	before := r.stateBytes
	if _, err := update("big0", "small", 1); err != nil {
		t.Fatalf("shrinking a value must be allowed: %v", err)
	}
	if r.stateBytes >= before {
		t.Fatalf("shrinking did not free bytes: %d -> %d", before, r.stateBytes)
	}
	if _, err := update(fmt.Sprint("big", filled), big, 0); err != nil {
		t.Fatalf("freed bytes must be reusable: %v", err)
	}
}

func TestStateConcurrentWritersOnlyOneWins(t *testing.T) {
	s, _ := start(t, false)
	r := s.room("a")
	var wg sync.WaitGroup
	var mu sync.Mutex
	wins := 0
	for i := range 32 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			r.mu.Lock()
			_, err := r.updateState(encoded(stateUpdate("k", i, 0)), fmt.Sprint("u", i))
			r.mu.Unlock()
			if err == nil {
				mu.Lock()
				wins++
				mu.Unlock()
			} else if !errors.Is(err, errStateConflict) {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	if wins != 1 || r.state["k"].Revision != 1 {
		t.Fatalf("wins %d, revision %d", wins, r.state["k"].Revision)
	}
}

func TestStateStaysInRoom(t *testing.T) {
	s, h := start(t, false)
	alice := connect(t, s, h, "a", "alice")
	other := connect(t, s, h, "b", "other")
	if out := request(t, alice, "state:update", "a", stateUpdate("k", "a", 0)); out["success"] != true {
		t.Fatal(out)
	}
	expectNone(t, other, "state:changed")
	if out := request(t, other, "state:get", "b", Object{"key": "k"}); out["entry"] != nil {
		t.Fatalf("state leaked across rooms: %v", out)
	}
	// 別の部屋では同じキーを revision 0 から作れる
	if out := request(t, other, "state:update", "b-create", stateUpdate("k", "b", 0)); out["success"] != true {
		t.Fatal(out)
	}
}
