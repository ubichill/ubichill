package runtime

import (
	"context"
	"net/http"
	"os"
	"slices"
	"testing"
	"time"

	"github.com/ubichill/ubichill/services/instance/internal/coord"
)

func nodeInfo(t *testing.T, dir coord.Directory, name string) coord.NodeInfo {
	t.Helper()
	info, ok, err := dir.Node(context.Background(), name)
	if err != nil || !ok {
		t.Fatalf("node %s: %v %v", name, ok, err)
	}
	return info
}

func ready(t *testing.T, n *node) int {
	t.Helper()
	res, err := http.Get(n.http.URL + "/ready")
	if err != nil {
		t.Fatal(err)
	}
	_ = res.Body.Close()
	return res.StatusCode
}

// 閉じた部屋を作らせない期間は Directory にあるので、閉じた Pod 以外に作成が届いても生き返らない。
func retiredOnEveryPod(t *testing.T, a, b *node, advance func(time.Duration)) {
	t.Helper()
	provision(t, a, "room")
	if code, _ := call(t, a.http, "DELETE", "/instances/room", nil, true); code != 204 {
		t.Fatalf("close: %d", code)
	}
	for _, n := range []*node{a, b} {
		if code, out := call(t, n.http, "PUT", "/instances/room", definition("room"), true); code != 400 || out["error"] != errRetired.Error() {
			t.Fatalf("recreate a closed room on %s: %d %v", n.node, code, out)
		}
	}
	// 誰も持っていない部屋を owner でない Pod が閉じても、全 Pod に効く
	if code, _ := call(t, b.http, "DELETE", "/instances/never-opened", nil, true); code != 204 {
		t.Fatalf("close an unassigned room: %d", code)
	}
	if code, _ := call(t, a.http, "PUT", "/instances/never-opened", definition("never-opened"), true); code != 400 {
		t.Fatalf("create a room another pod closed: %d", code)
	}
	if advance == nil {
		return
	}
	advance(retiredFor)
	code, out := call(t, b.http, "PUT", "/instances/room", definition("room"), true)
	if code != 200 || out["node"] != b.node || out["epoch"] != float64(2) {
		t.Fatalf("after the retirement: %d %v", code, out)
	}
}

func TestRetiredRoomIsNotRecreatedOnAnotherPod(t *testing.T) {
	c := newCluster()
	retiredOnEveryPod(t, c.pod(t, "node-a"), c.pod(t, "node-b"), c.clock.Advance)
}

// draining のノードは新しい部屋を 503 で断る（backend は別のノードを選び直す）。持っている部屋は入室・操作とも動き続ける。
func TestDrainingNodeRefusesNewRoomsAndKeepsItsRooms(t *testing.T) {
	c := newCluster()
	a, b := c.pod(t, "node-a"), c.pod(t, "node-b")
	provision(t, a, "room")
	a.maintain()
	b.maintain()
	alice, out := joinWith(t, b.http, "room", memberGrant(t, a, "room", "alice"))
	joined(t, out)

	a.beginDrain()
	if got := nodeInfo(t, c.dir, "node-a").State; got != coord.NodeDraining {
		t.Fatalf("state right after draining = %s", got)
	}
	if ra, rb := ready(t, a), ready(t, b); ra != 503 || rb != 200 {
		t.Fatalf("readiness: a=%d b=%d", ra, rb)
	}
	if code, out := call(t, a.http, "PUT", "/instances/fresh", definition("fresh"), true); code != 503 || a.room("fresh") != nil {
		t.Fatalf("new room on a draining node: %d %v", code, out)
	}
	if code, out := call(t, b.http, "PUT", "/instances/fresh", definition("fresh"), true); code != 200 || out["node"] != b.node {
		t.Fatalf("new room on another node: %d %v", code, out)
	}
	// 持っている部屋の作成（冪等）・チケット・入室・操作は続く
	if code, out := call(t, a.http, "PUT", "/instances/room", definition("room"), true); code != 200 || out["node"] != a.node {
		t.Fatalf("existing room on a draining node: %d %v", code, out)
	}
	bob, out := joinWith(t, a.http, "room", memberGrant(t, a, "room", "bob"))
	joined(t, out)
	receive(t, alice, "user:joined")
	createEntity(t, bob, Object{"by": "bob"})
	receive(t, alice, "entity:created")
	// 延長も続く（draining は自己停止ではない）
	c.clock.Advance(testFencing.Interval)
	if !a.maintain() || a.owned("room") == nil {
		t.Fatal("a draining node stopped renewing its room")
	}
	if got := nodeInfo(t, c.dir, "node-a").State; got != coord.NodeDraining {
		t.Fatalf("state after the next heartbeat = %s", got)
	}

	// Drain は接続（直接と中継の両方）が無くなるまで待つ
	drained := make(chan struct{})
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		a.Drain(ctx)
		close(drained)
	}()
	select {
	case <-drained:
		t.Fatal("drain returned while participants were connected")
	case <-time.After(300 * time.Millisecond):
	}
	_ = alice.Close()
	_ = bob.Close()
	select {
	case <-drained:
	case <-time.After(3 * time.Second):
		t.Fatal("drain did not return after the participants left")
	}
	// 終了で割り当てを解放するので、別のノードがすぐに新しい epoch で作れる
	a.Close()
	if next := provision(t, b, "room"); next.epoch != 2 {
		t.Fatalf("epoch after the drained node closed = %d", next.epoch)
	}
}

func TestDrainGivesUpWhenTheTimeoutEnds(t *testing.T) {
	c := newCluster()
	a := c.pod(t, "node-a")
	provision(t, a, "room")
	alice, out := joinWith(t, a.http, "room", memberGrant(t, a, "room", "alice"))
	joined(t, out)
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	start := time.Now()
	a.Drain(ctx)
	if time.Since(start) > 2*time.Second {
		t.Fatal("drain ignored its timeout")
	}
	a.Close()
	expectClosed(t, alice, "instance:closing")
}

// heartbeat の接続数は、部屋の参加者に中継している接続を足す（中継する Pod にも負荷がかかる）。部屋の上限は capacity として書く。
func TestHeartbeatCountsRelayedConnectionsAndCapacity(t *testing.T) {
	c := newCluster()
	a := c.pod(t, "node-a")
	b := startPodWith(t, c.dir, "node-b", c.clock.Now, func(config *Config) { config.MaxRooms = 1 })
	provision(t, a, "room")
	a.maintain()
	_, out := joinWith(t, b.http, "room", memberGrant(t, a, "room", "alice"))
	joined(t, out)
	_, out = joinWith(t, a.http, "room", memberGrant(t, a, "room", "bob"))
	joined(t, out)
	a.maintain()
	b.maintain()
	if got := nodeInfo(t, c.dir, "node-a"); got.Rooms != 1 || got.Connections != 2 || got.Capacity != 1000 || got.State != coord.NodeReady {
		t.Fatalf("owner = %+v", got)
	}
	if got := nodeInfo(t, c.dir, "node-b"); got.Rooms != 0 || got.Connections != 1 || got.Capacity != 1 {
		t.Fatalf("relaying node = %+v", got)
	}
	// 上限に達したノードは 503（backend は別のノードを選び直す）
	provision(t, b, "one")
	if code, _ := call(t, b.http, "PUT", "/instances/two", definition("two"), true); code != 503 {
		t.Fatalf("a full node: %d", code)
	}
}

// owner の Pod が割り当てを解放せずに消える（プロセスが落ちる）。リースの TTL が切れるまでは別の Pod は作り直さず、
// 切れたら次の入室（backend の作成）で別の Pod が新しい epoch で作り、新しいチケットで入れる。古いチケットは通らない。
func TestOwnerVanishesAndAnotherPodTakesOverAfterTheLease(t *testing.T) {
	c := newCluster()
	a, b, edge := c.pod(t, "node-a"), c.pod(t, "node-b"), c.pod(t, "node-c")
	provision(t, a, "room")
	for _, n := range []*node{a, b, edge} {
		n.maintain()
	}
	stale := memberGrant(t, a, "room", "alice")

	// a が消える。延長も heartbeat も止まり、中継先のアドレスにも繋がらない
	a.http.Close()
	a.link.down.Store(true)
	c.clock.Advance(testFencing.TTL - time.Second)
	b.maintain()
	edge.maintain()
	code, out := call(t, b.http, "PUT", "/instances/room", definition("room"), true)
	if owner, _ := out["owner"].(map[string]any); code != 409 || owner["node"] != a.node {
		t.Fatalf("before the lease expires: %d %v", code, out)
	}
	if _, out := joinWith(t, edge.http, "room", stale); out["code"] != "instance_unavailable" {
		t.Fatalf("join while the owner is gone: %v", out)
	}

	c.clock.Advance(time.Second)
	code, out = call(t, b.http, "PUT", "/instances/room", definition("room"), true)
	if code != 200 || out["node"] != b.node || out["epoch"] != float64(2) {
		t.Fatalf("after the lease expired: %d %v", code, out)
	}
	b.maintain()
	if _, out := joinWith(t, edge.http, "room", stale); out["code"] != "ticket_invalid" {
		t.Fatalf("stale ticket through the relay: %v", out)
	}
	if _, out := joinWith(t, b.http, "room", stale); out["code"] != "ticket_invalid" {
		t.Fatalf("stale ticket at the new owner: %v", out)
	}
	again, out := joinWith(t, edge.http, "room", memberGrant(t, b, "room", "alice"))
	joined(t, out)
	createEntity(t, again, Object{})
	if got := members(b.Server, "room"); !slices.Equal(got, []string{"alice"}) {
		t.Fatalf("members = %v", got)
	}
}

// Redis の Directory で、閉じた部屋が別の Pod で作れないこと、owner が消えたあとリースの期限で別の Pod が取ること、
// draining を書くことを確かめる（REDIS_URL があるときだけ）。
func TestRedisFailoverAcrossPods(t *testing.T) {
	url := os.Getenv("REDIS_URL")
	if url == "" {
		t.Skip("REDIS_URL is not set")
	}
	client, err := coord.NewRedisClient(url, os.Getenv("REDIS_PASSWORD"))
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	prefix := "ubi:test:failover:" + newID() + ":"
	t.Cleanup(func() {
		keys, _ := client.Keys(ctx, prefix+"*").Result()
		if len(keys) > 0 {
			_ = client.Del(ctx, keys...).Err()
		}
		_ = client.Close()
	})
	dir := coord.NewRedisDirectory(client, prefix)
	short := Fencing{TTL: 600 * time.Millisecond, Margin: 200 * time.Millisecond, Interval: 200 * time.Millisecond, Retry: 100 * time.Millisecond, Timeout: time.Second}
	pod := func(name string) *node {
		return startPodWith(t, dir, name, nil, func(config *Config) { config.Fencing = short })
	}
	a, b, edge := pod("node-a"), pod("node-b"), pod("node-c")
	retiredOnEveryPod(t, a, b, nil)

	provision(t, a, "live")
	for _, n := range []*node{a, b, edge} {
		n.maintain()
	}
	stale := memberGrant(t, a, "live", "alice")
	a.http.Close()
	a.link.down.Store(true)
	if code, _ := call(t, b.http, "PUT", "/instances/live", definition("live"), true); code != 409 {
		t.Fatalf("before the lease expires: %d", code)
	}
	time.Sleep(short.TTL + 100*time.Millisecond)
	if next := provision(t, b, "live"); next.epoch != 2 {
		t.Fatalf("epoch = %d", next.epoch)
	}
	b.maintain()
	if _, out := joinWith(t, edge.http, "live", stale); out["code"] != "ticket_invalid" {
		t.Fatalf("stale ticket: %v", out)
	}
	_, out := joinWith(t, edge.http, "live", memberGrant(t, b, "live", "alice"))
	joined(t, out)

	b.beginDrain()
	if got := nodeInfo(t, dir, "node-b"); got.State != coord.NodeDraining {
		t.Fatalf("node-b = %+v", got)
	}
	if code, _ := call(t, b.http, "PUT", "/instances/fresh", definition("fresh"), true); code != 503 {
		t.Fatalf("new room on a draining node: %d", code)
	}
}
