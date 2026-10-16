package runtime

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/ubichill/ubichill/services/instance/internal/coord"
)

type interleavedRetirement struct {
	coord.Directory
	beforeRetire func()
}

func (d *interleavedRetirement) Retire(ctx context.Context, room, token string, ttl time.Duration) (bool, error) {
	d.beforeRetire()
	return d.Directory.Retire(ctx, room, token, ttl)
}

func TestDeleteRejectsRoomAcquiredAfterOwnerLookup(t *testing.T) {
	shared := coord.NewMemoryDirectory(time.Now)
	b := newServer(Config{AdminToken: strings.Repeat("a", 32), Directory: shared, Node: "node-b"})
	defer b.Close()
	interleaved := &interleavedRetirement{Directory: shared, beforeRetire: func() {
		if _, err := b.Provision(definition("racing-room")); err != nil {
			t.Fatal(err)
		}
	}}
	a := newServer(Config{AdminToken: strings.Repeat("a", 32), Directory: interleaved, Node: "node-a"})
	defer a.Close()
	code, body := a.closeInstance(context.Background(), "racing-room", "1", expectation{})
	if code != 409 {
		t.Fatalf("DELETE = %d %v, want conflict", code, body)
	}
	if b.owned("racing-room") == nil {
		t.Fatal("new owner was closed")
	}
	if code, _ := call(t, startPod(t, shared, "node-c", nil).http, "PUT", "/instances/racing-room", definition("racing-room"), true); code != 409 {
		t.Fatalf("new room was retired: PUT = %d", code)
	}
}

func TestDeleteFailsClosedWhenRetirementCannotReachRedis(t *testing.T) {
	c := newCluster()
	a := c.pod(t, "node-a")
	provision(t, a, "room")
	a.link.down.Store(true)
	if code, _ := call(t, a.http, "DELETE", "/instances/room", nil, true); code != 503 {
		t.Fatalf("DELETE = %d", code)
	}
	if a.owned("room") == nil {
		t.Fatal("failed deletion closed the room")
	}
}

func TestAbsentObservationCannotCloseAnExistingRoom(t *testing.T) {
	c := newCluster()
	a, b := c.pod(t, "node-a"), c.pod(t, "node-b")
	provision(t, b, "room")
	for _, n := range []*node{a, b} {
		if code, _ := call(t, n.http, "DELETE", "/instances/room?absent=true", nil, true); code != 409 {
			t.Fatalf("absent DELETE on %s = %d", n.node, code)
		}
	}
	if b.owned("room") == nil {
		t.Fatal("the new room was closed")
	}
	if code, _ := call(t, a.http, "DELETE", "/instances/room?absent=true&gen=g1&epoch=1", nil, true); code != 400 {
		t.Fatalf("conflicting expectations = %d", code)
	}
}
