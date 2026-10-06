package runtime

import (
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"slices"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

// expectClosed reads until the server closes the connection, failing on a timeout or forbidden event.
func expectClosed(t *testing.T, c *websocket.Conn, forbidden string) {
	t.Helper()
	_ = c.SetReadDeadline(time.Now().Add(2 * time.Second))
	for {
		var f Frame
		err := c.ReadJSON(&f)
		var timeout net.Error
		if errors.As(err, &timeout) && timeout.Timeout() {
			t.Fatal("connection was not closed")
		}
		if err != nil {
			return
		}
		if forbidden != "" && f.Event == forbidden {
			t.Fatalf("unexpected %s", forbidden)
		}
	}
}
func members(s *Server, room string) []string { return s.room(room).presence().MemberIDs }

func TestSameRoomSessionReplacedArrivesBeforeDisconnect(t *testing.T) {
	s, h := start(t, false)
	first := connect(t, s, h, "a", "alice")
	_ = connect(t, s, h, "a", "alice")
	receive(t, first, "session:replaced")
	expectClosed(t, first, "")
	// The replaced connection closing must not evict the new session.
	time.Sleep(50 * time.Millisecond)
	if !slices.Equal(members(s, "a"), []string{"alice"}) {
		t.Fatalf("new session lost: %v", members(s, "a"))
	}
}

func TestReconnectWithinGraceKeepsMembershipAndLock(t *testing.T) {
	s, h := start(t, false)
	s.config.Grace = 300 * time.Millisecond
	alice := connect(t, s, h, "a", "alice")
	bob := connect(t, s, h, "a", "bob")
	id := createEntity(t, alice, Object{})
	_ = request(t, alice, "entity:patch", "lock", Object{"entityId": id, "patch": Object{"lockedBy": "alice"}})
	_ = alice.Close()
	deadline := time.Now().Add(time.Second)
	for {
		r := s.room("a")
		r.mu.Lock()
		disconnected := r.members["alice"] != nil && r.members["alice"].peer == nil
		r.mu.Unlock()
		if disconnected {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("disconnect was not observed")
		}
		time.Sleep(time.Millisecond)
	}
	_ = connect(t, s, h, "a", "alice")
	time.Sleep(500 * time.Millisecond)
	expectNone(t, bob, "user:left")
	if !slices.Equal(members(s, "a"), []string{"alice", "bob"}) {
		t.Fatalf("membership lost after reconnect: %v", members(s, "a"))
	}
	if entityIn(s, "a", id)["lockedBy"] != "alice" {
		t.Fatal("lock released although the user returned within grace")
	}
}

func TestWorldLeaveReleasesImmediately(t *testing.T) {
	s, h := start(t, false)
	s.config.Grace = time.Hour
	alice := connect(t, s, h, "a", "alice")
	bob := connect(t, s, h, "a", "bob")
	if out := request(t, alice, "world:leave", "leave", nil); out["success"] != true {
		t.Fatal(out)
	}
	var left string
	_ = json.Unmarshal(receive(t, bob, "user:left").Data, &left)
	if left != "alice" {
		t.Fatalf("user:left = %q", left)
	}
	expectClosed(t, alice, "")
	if !slices.Equal(members(s, "a"), []string{"bob"}) {
		t.Fatalf("leave must not wait for grace: %v", members(s, "a"))
	}
}

func TestOnlyDeliberateCloseAnnouncesClosing(t *testing.T) {
	s, h := start(t, false)
	alice := connect(t, s, h, "a", "alice")
	other := connect(t, s, h, "b", "other")
	if code, _ := call(t, h, "DELETE", "/instances/a", nil, true); code != 204 {
		t.Fatal(code)
	}
	receive(t, alice, "instance:closing")
	expectClosed(t, alice, "")
	// A process shutdown is not the end of the instance: clients must reconnect and reprovision.
	s.Close()
	expectClosed(t, other, "instance:closing")
}

func TestRateLimitRejectsWithoutDisconnecting(t *testing.T) {
	s, h := start(t, false)
	alice := connect(t, s, h, "a", "alice")
	const total = 300
	for i := range total {
		_ = alice.WriteJSON(Frame{Event: "media:timeline:get", ID: fmt.Sprintf("r%d", i), Data: encoded(Object{"sessionId": "v"})})
	}
	limited := 0
	for i := range total {
		reply, _ := object(receive(t, alice, fmt.Sprintf("r%d", i)).Data)
		if reply["error"] == "rate limit exceeded" {
			limited++
		}
	}
	// The join frame counts toward the same one-second window.
	if limited == 0 || limited > total-239 {
		t.Fatalf("limited %d of %d frames", limited, total)
	}
	time.Sleep(1100 * time.Millisecond)
	if out := request(t, alice, "media:timeline:get", "after", Object{"sessionId": "v"}); out["success"] != true {
		t.Fatal("rate limit did not reset")
	}
}

func TestSnapshotKeepsEntityOrder(t *testing.T) {
	s, h := start(t, false)
	d := definition("ordered")
	for _, id := range []string{"e3", "e1", "e2"} {
		d.Snapshot.Entities = append(d.Snapshot.Entities, Object{"id": id, "type": "pen:stroke", "ownerId": nil, "lockedBy": nil, "transform": fullTransform(), "data": Object{}})
	}
	if _, err := s.Provision(d); err != nil {
		t.Fatal(err)
	}
	ids := func(snapshot Snapshot) []string {
		out := []string{}
		for _, e := range snapshot.Entities {
			out = append(out, str(e["id"]))
		}
		return out
	}
	alice, snapshot := join(t, s, h, "ordered", "alice")
	if got := ids(snapshot); !slices.Equal(got, []string{"e3", "e1", "e2"}) {
		t.Fatalf("world order lost: %v", got)
	}
	created := createEntity(t, alice, Object{})
	_ = request(t, alice, "entity:patch", "patch-e3", Object{"entityId": "e3", "patch": Object{"data": Object{"v": float64(1)}}})
	_ = request(t, alice, "entity:delete", "delete-e1", "e1")
	for range 5 {
		c, snapshot := join(t, s, h, "ordered", "bob")
		if got := ids(snapshot); !slices.Equal(got, []string{"e3", "e2", created}) {
			t.Fatalf("snapshot order is not stable: %v", got)
		}
		_ = c.Close()
	}
}
