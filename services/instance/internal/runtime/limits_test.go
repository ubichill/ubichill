package runtime

import (
	"errors"
	"net/http"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/ubichill/ubichill/services/instance/internal/coord"
)

// limitedPod は接続数の上限を付けた Pod。部屋の人数の上限は広げておく（上限で断るのが接続数のためだと分かるように）。
func limitedPod(t *testing.T, c *cluster, name string, limit int, grace time.Duration) *node {
	t.Helper()
	return startPodWith(t, c.dir, name, c.clock.Now, func(config *Config) {
		config.MaxConnections = limit
		if grace > 0 {
			config.Grace = grace
		}
	})
}

func provisionWide(t *testing.T, n *node, room string) {
	t.Helper()
	if _, err := n.Provision(roomFor(room, 50)); err != nil {
		t.Fatal(err)
	}
	n.maintain()
}

func expectUnavailable(t *testing.T, label string, out Object) {
	t.Helper()
	if out["success"] != false || out["code"] != "instance_unavailable" {
		t.Fatalf("%s: %v", label, out)
	}
}

func alive(t *testing.T, c *websocket.Conn) {
	t.Helper()
	if out := request(t, c, "state:get", "alive-"+newID(), Object{"key": "k"}); out["success"] != true {
		t.Fatalf("an admitted participant was cut: %v", out)
	}
}

// 上限ちょうどまでは入れ、超える新しい参加者は instance_unavailable で断る。入室中の人は切らない。
// 猶予中の人の戻りと、同じ人の別の接続（session:replaced）は断らない。
func TestConnectionLimitRejectsNewParticipantsOnly(t *testing.T) {
	c := newCluster()
	a := limitedPod(t, c, "node-a", 2, 5*time.Second)
	provisionWide(t, a, "room")
	alice, out := joinWith(t, a.http, "room", memberGrant(t, a, "room", "alice"))
	joined(t, out)
	bob, out := joinWith(t, a.http, "room", memberGrant(t, a, "room", "bob"))
	joined(t, out)

	_, out = joinWith(t, a.http, "room", memberGrant(t, a, "room", "carol"))
	expectUnavailable(t, "carol over the limit", out)
	alive(t, alice)
	alive(t, bob)
	expectMetrics(t, "full", scrape(t, a), map[string]int{
		"websocket_connections": 2, "connection_capacity": 2, rejectedSeries: 1, "room_capacity_available": 0, "draining": 0,
	})

	// 同じ人の別の接続は数が増えない
	bob2, out := joinWith(t, a.http, "room", memberGrant(t, a, "room", "bob"))
	joined(t, out)
	receive(t, bob, "session:replaced")
	alive(t, bob2)

	// 切れた alice は猶予の間は在席のまま。空いた枠に carol が入ったあとでも、alice は戻れる（数えていた人が戻るだけ）
	_ = alice.Close()
	eventually(t, "alice's connection was still counted", func() bool { return a.connections() == 1 })
	carol, out := joinWith(t, a.http, "room", memberGrant(t, a, "room", "carol"))
	joined(t, out)
	alice, out = joinWith(t, a.http, "room", memberGrant(t, a, "room", "alice"))
	joined(t, out)
	if n := a.connections(); n != 3 {
		t.Fatalf("connections = %d", n)
	}
	_, out = joinWith(t, a.http, "room", memberGrant(t, a, "room", "dave"))
	expectUnavailable(t, "dave over the limit", out)
	for _, c := range []*websocket.Conn{alice, bob2, carol} {
		alive(t, c)
	}
	expectMetrics(t, "after", scrape(t, a), map[string]int{rejectedSeries: 2})
	// /ready は落とさない（Service から外れると中継している接続まで draining と同じ扱いになる）
	if res, err := http.Get(a.http.URL + "/ready"); err != nil || res.StatusCode != 200 {
		t.Fatalf("/ready at the limit: %v %v", res, err)
	}
}

// 上限 0 は無制限。
func TestConnectionLimitZeroIsUnlimited(t *testing.T) {
	c := newCluster()
	a := limitedPod(t, c, "node-a", 0, 0)
	provisionWide(t, a, "room")
	for _, user := range []string{"u1", "u2", "u3", "u4", "u5"} {
		_, out := joinWith(t, a.http, "room", memberGrant(t, a, "room", user))
		joined(t, out)
	}
	provisionWide(t, a, "another")
	expectMetrics(t, "unlimited", scrape(t, a), map[string]int{
		"websocket_connections": 5, "connection_capacity": 0, rejectedSeries: 0, "room_capacity_available": 998,
	})
	a.maintain()
	if info := nodeInfo(t, c.dir, "node-a"); info.Full {
		t.Fatalf("heartbeat = %+v", info)
	}
}

// 上限の 9 割から新しい部屋（作成・引っ越し）を断り、heartbeat と指標で空きを 0 にする。持っている部屋にはまだ入れる。
func TestConnectionLimitStopsNewRoomsBeforeJoins(t *testing.T) {
	c := newCluster()
	a := limitedPod(t, c, "node-a", 10, 0)
	provisionWide(t, a, "room")
	for i := range 8 {
		_, out := joinWith(t, a.http, "room", memberGrant(t, a, "room", "u"+string(rune('0'+i))))
		joined(t, out)
	}
	a.maintain()
	if info := nodeInfo(t, c.dir, "node-a"); info.Full {
		t.Fatalf("full below 90%%: %+v", info)
	}
	provisionWide(t, a, "below-cutoff")

	_, out := joinWith(t, a.http, "room", memberGrant(t, a, "room", "u8"))
	joined(t, out)
	if code, out := call(t, a.http, "PUT", "/instances/new", roomFor("new", 50), true); code != 503 {
		t.Fatalf("new room at 90%%: %d %v", code, out)
	}
	// 持っている部屋の作成は冪等に返す
	if code, out := call(t, a.http, "PUT", "/instances/room", roomFor("room", 50), true); code != 200 {
		t.Fatalf("existing room at 90%%: %d %v", code, out)
	}
	if _, err := a.prepareHandoff("moving", "node-z", handoffSnapshot{Definition: roomFor("moving", 50)}); !errors.Is(err, errNodeFull) {
		t.Fatalf("handoff at 90%%: %v", err)
	}
	a.maintain()
	if info := nodeInfo(t, c.dir, "node-a"); !info.Full || info.State != coord.NodeReady || info.Connections != 9 {
		t.Fatalf("heartbeat at 90%%: %+v", info)
	}
	expectMetrics(t, "cutoff", scrape(t, a), map[string]int{"room_capacity_available": 0, "draining": 0, rejectedSeries: 0})

	_, out = joinWith(t, a.http, "room", memberGrant(t, a, "room", "u9"))
	joined(t, out)
	_, out = joinWith(t, a.http, "room", memberGrant(t, a, "room", "u10"))
	expectUnavailable(t, "over the limit", out)
}

// 上限は中継の両側で効く: owner は中継されてきた新しい参加者を断り、中継元は中継を始める前に断る（中継も 1 本と数える）。
func TestConnectionLimitAppliesToRelayedJoinsOnBothSides(t *testing.T) {
	c := newCluster()
	owner := limitedPod(t, c, "node-a", 1, 0)
	edge := limitedPod(t, c, "node-b", 1, 0)
	provisionWide(t, owner, "room-a")
	provisionWide(t, edge, "room-b")
	_, out := joinWith(t, owner.http, "room-a", memberGrant(t, owner, "room-a", "alice"))
	joined(t, out)

	_, out = joinWith(t, c.pod(t, "node-c").http, "room-a", memberGrant(t, owner, "room-a", "bob"))
	expectUnavailable(t, "relayed into a full owner", out)
	expectMetrics(t, "owner", scrape(t, owner), map[string]int{rejectedSeries: 1, "websocket_connections": 1})

	_, out = joinWith(t, edge.http, "room-b", memberGrant(t, edge, "room-b", "carol"))
	joined(t, out)
	_, out = joinWith(t, edge.http, "room-a", memberGrant(t, owner, "room-a", "dave"))
	expectUnavailable(t, "relay from a full edge", out)
	if edge.relayCount() != 0 {
		t.Fatalf("the full edge opened a relay: %d", edge.relayCount())
	}
	expectMetrics(t, "edge", scrape(t, edge), map[string]int{rejectedSeries: 1, "websocket_connections": 1})
	expectMetrics(t, "owner after", scrape(t, owner), map[string]int{rejectedSeries: 1})
}

// 接続数で新しい部屋を断っているノードは、引っ越し先にもしない（古い版は full を書かないので部屋数だけで決まる）。
func TestHandoffTargetsSkipNodesNearTheConnectionLimit(t *testing.T) {
	got := handoffTargets("self", map[string]coord.NodeInfo{
		"full":   {Addr: "full:1", State: coord.NodeReady, Capacity: 10, Full: true},
		"busy":   {Addr: "busy:1", State: coord.NodeReady, Capacity: 10, Connections: 500},
		"legacy": {Addr: "legacy:1", State: coord.NodeReady, Capacity: 10, Connections: 600},
	})
	if len(got) != 2 || got[0].node != "busy" || got[1].node != "legacy" {
		t.Fatalf("targets = %+v", got)
	}
}

func TestRoomCutoffIsNinetyPercentRoundedUp(t *testing.T) {
	for limit, want := range map[int]int{1: 1, 2: 2, 9: 9, 10: 9, 11: 10, 375: 338} {
		if got := roomCutoff(limit); got != want {
			t.Fatalf("roomCutoff(%d) = %d, want %d", limit, got, want)
		}
	}
	s := newServer(Config{MaxConnections: 10})
	if !s.admitsConnection(9) || s.admitsConnection(10) || !s.admitsRooms(8) || s.admitsRooms(9) {
		t.Fatal("thresholds of a limit of 10")
	}
}
