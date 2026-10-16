package runtime

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/ubichill/ubichill/services/instance/internal/coord"
)

// startPod は Directory を共有する Pod を 1 つ立てる。heartbeat に書くアドレスは実際に待ち受けているアドレス（中継先）。
// clock が nil なら実時間。
func startPod(t *testing.T, dir coord.Directory, name string, clock func() time.Time) *node {
	t.Helper()
	return startPodWith(t, dir, name, clock, nil)
}

// startPodWith は設定を変えた Pod を立てる（部屋の上限・fencing の時間など）。
func startPodWith(t *testing.T, dir coord.Directory, name string, clock func() time.Time, configure func(*Config)) *node {
	t.Helper()
	link := &partitioned{Directory: dir}
	h := httptest.NewUnstartedServer(nil)
	config := Config{
		AdminToken: strings.Repeat("a", 32), Grace: 20 * time.Millisecond,
		Directory: link, Node: name, Addr: h.Listener.Addr().String(), Fencing: testFencing, Clock: clock,
	}
	if configure != nil {
		configure(&config)
	}
	s := newServer(config)
	h.Config.Handler = s.Handler()
	h.Start()
	t.Cleanup(func() { s.Close(); h.Close() })
	return &node{s, h, link}
}

func (c *cluster) pod(t *testing.T, name string) *node { return startPod(t, c.dir, name, c.clock.Now) }

func relayURL(n *node) string { return "ws" + strings.TrimPrefix(n.http.URL, "http") + relayPath }

func eventually(t *testing.T, what string, ok func() bool) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for !ok() {
		if time.Now().After(deadline) {
			t.Fatal(what)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func joined(t *testing.T, out Object) {
	t.Helper()
	if out["success"] != true {
		t.Fatalf("join: %v", out)
	}
}

// 2 つの Pod が別々の部屋を持ち、どちらの Pod に繋いでも同じ部屋の参加者は owner に集まって互いの操作を受け取る。
func spreadAndConverge(t *testing.T, a, b *node) {
	t.Helper()
	code, pa := call(t, a.http, "PUT", "/instances/room-a", definition("room-a"), true)
	if code != 200 || pa["node"] != a.node || pa["addr"] != a.config.Addr {
		t.Fatalf("room-a on %s: %d %v", a.node, code, pa)
	}
	if code, pb := call(t, b.http, "PUT", "/instances/room-b", definition("room-b"), true); code != 200 || pb["node"] != b.node {
		t.Fatalf("room-b on %s: %d %v", b.node, code, pb)
	}
	a.maintain()
	b.maintain()
	// Service が別の Pod に当てても、作り直さずに owner と内部アドレスを返す
	code, out := call(t, b.http, "PUT", "/instances/room-a", definition("room-a"), true)
	if owner, _ := out["owner"].(map[string]any); code != 409 || owner["node"] != a.node || owner["addr"] != a.config.Addr || owner["alive"] != true {
		t.Fatalf("room-a through %s: %d %v", b.node, code, out)
	}

	alice, out := joinWith(t, b.http, "room-a", memberGrant(t, a, "room-a", "alice"))
	joined(t, out)
	bob, out := joinWith(t, a.http, "room-a", memberGrant(t, a, "room-a", "bob"))
	joined(t, out)
	receive(t, alice, "user:joined")
	if got := members(a.Server, "room-a"); !slices.Equal(got, []string{"alice", "bob"}) {
		t.Fatalf("owner's members = %v", got)
	}
	if b.room("room-a") != nil {
		t.Fatal("the relaying pod created its own copy of the room")
	}
	createEntity(t, alice, Object{"by": "alice"})
	if f := receive(t, bob, "entity:created"); !strings.Contains(string(f.Data), `"alice"`) {
		t.Fatalf("bob got %s", f.Data)
	}
	createEntity(t, bob, Object{"by": "bob"})
	if f := receive(t, alice, "entity:created"); !strings.Contains(string(f.Data), `"bob"`) {
		t.Fatalf("alice got %s", f.Data)
	}

	carol, out := joinWith(t, a.http, "room-b", memberGrant(t, b, "room-b", "carol"))
	joined(t, out)
	if got := members(b.Server, "room-b"); !slices.Equal(got, []string{"carol"}) {
		t.Fatalf("room-b members = %v", got)
	}
	if got := request(t, carol, "media:timeline:get", "through-a", Object{"sessionId": "s"}); got["success"] != true {
		t.Fatalf("request through the relay: %v", got)
	}
}

func TestRoomsSpreadAcrossPodsAndJoinsConvergeOnTheOwner(t *testing.T) {
	c := newCluster()
	spreadAndConverge(t, c.pod(t, "node-a"), c.pod(t, "node-b"))
}

func TestOwnerSelfStopClosesRelayedConnectionsAndANewTicketGetsBackIn(t *testing.T) {
	c := newCluster()
	a, b, edge := c.pod(t, "node-a"), c.pod(t, "node-b"), c.pod(t, "node-c")
	provision(t, a, "room")
	for _, n := range []*node{a, b, edge} {
		n.maintain()
	}
	stale := memberGrant(t, a, "room", "alice")
	alice, out := joinWith(t, edge.http, "room", stale)
	joined(t, out)
	bob, out := joinWith(t, a.http, "room", memberGrant(t, a, "room", "bob"))
	joined(t, out)

	// owner だけ Redis から切り離され、自己停止の期限を過ぎる
	a.link.down.Store(true)
	c.clock.Advance(testFencing.TTL - testFencing.Margin)
	a.maintain()
	expectClosed(t, alice, "instance:closing")
	expectClosed(t, bob, "instance:closing")
	eventually(t, "relays were left open", func() bool { return edge.relayCount() == 0 })

	// リースが切れるまでは新しい owner は取れない。切れたら別の Pod が新しい epoch で取る
	c.clock.Advance(testFencing.Margin)
	b.maintain()
	edge.maintain()
	next := provision(t, b, "room")
	if next.epoch != 2 {
		t.Fatalf("epoch = %d", next.epoch)
	}
	b.maintain()
	// 中継元でも owner でも、前の世代のチケットは取り直しを促す
	if _, out := joinWith(t, edge.http, "room", stale); out["code"] != "ticket_invalid" {
		t.Fatalf("stale ticket through the relay: %v", out)
	}
	if _, out := joinWith(t, b.http, "room", stale); out["code"] != "ticket_invalid" {
		t.Fatalf("stale ticket at the owner: %v", out)
	}
	again, out := joinWith(t, edge.http, "room", memberGrant(t, b, "room", "alice"))
	joined(t, out)
	if got := members(b.Server, "room"); !slices.Equal(got, []string{"alice"}) {
		t.Fatalf("members = %v", got)
	}
	createEntity(t, again, Object{})
}

func TestJoinWhenTheOwnerIsGoneIsUnavailable(t *testing.T) {
	c := newCluster()
	a, edge := c.pod(t, "node-a"), c.pod(t, "node-b")
	provision(t, a, "room")
	token := memberGrant(t, a, "room", "alice")
	// owner の heartbeat が一度も無い（落ちている）
	if _, out := joinWith(t, edge.http, "room", token); out["code"] != "instance_unavailable" {
		t.Fatalf("join without a live owner: %v", out)
	}
	a.maintain()
	// 中継先のアドレスに別の Pod（再起動で IP を使い回したなど）が居ても、宛先のノード ID が違うので入れない
	ctx := context.Background()
	if err := c.dir.Heartbeat(ctx, "node-a", coord.NodeInfo{Addr: edge.config.Addr, State: coord.NodeReady}, testFencing.TTL); err != nil {
		t.Fatal(err)
	}
	if _, out := joinWith(t, edge.http, "room", token); out["code"] != "instance_unavailable" {
		t.Fatalf("join relayed to the wrong pod: %v", out)
	}
	// 部屋の割り当てが無ければ中継しない
	if _, out := joinWith(t, edge.http, "missing", edge.sign(memberTicket("missing"))); out["code"] != "instance_unavailable" {
		t.Fatalf("join to an unassigned room: %v", out)
	}
}

func TestRelayEndpointRejectsConnectionsWithoutAPodCredential(t *testing.T) {
	c := newCluster()
	a, b := c.pod(t, "node-a"), c.pod(t, "node-b")
	provision(t, a, "room")
	a.maintain()
	stranger := newServer(Config{AdminToken: strings.Repeat("z", 32), Node: "node-x"})
	expired := b.signRelay(relayClaims{From: b.node, To: a.node, Expires: time.Now().Add(-time.Second).Unix()})
	for _, tc := range []struct {
		name   string
		header http.Header
		want   int
	}{
		{"no credential", nil, http.StatusUnauthorized},
		{"another cluster's key", http.Header{relayHeader: {stranger.relayCredential(a.node)}}, http.StatusUnauthorized},
		{"expired", http.Header{relayHeader: {expired}}, http.StatusUnauthorized},
		{"tampered", http.Header{relayHeader: {b.relayCredential(a.node) + "x"}}, http.StatusUnauthorized},
		{"addressed to another node", http.Header{relayHeader: {b.relayCredential(b.node)}}, http.StatusMisdirectedRequest},
	} {
		_, resp, err := websocket.DefaultDialer.Dial(relayURL(a), tc.header)
		if err == nil || resp == nil || resp.StatusCode != tc.want {
			status := 0
			if resp != nil {
				status = resp.StatusCode
			}
			t.Fatalf("%s: err=%v status=%d (want %d)", tc.name, err, status, tc.want)
		}
	}
	// 中継用の口でも owner はチケットを確かめる（中継元を信用しない）
	conn, _, err := websocket.DefaultDialer.Dial(relayURL(a), http.Header{relayHeader: {b.relayCredential(a.node)}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = conn.Close() })
	forged := strings.Repeat("x", 10) + "." + strings.Repeat("y", 10)
	if got := request(t, conn, "world:join", "forged", Object{"instanceId": "room", "token": forged, "user": Object{"name": "Mallory", "status": "online", "position": Object{"x": 0, "y": 0}}}); got["code"] != "ticket_invalid" {
		t.Fatalf("forged ticket through the relay endpoint: %v", got)
	}
}

func TestRelayedConnectionsAreNotRelayedAgain(t *testing.T) {
	c := newCluster()
	a, b := c.pod(t, "node-a"), c.pod(t, "node-b")
	provision(t, b, "room")
	b.maintain()
	// a に中継された接続の部屋が a に無くても、a は b へ中継し直さない
	conn, _, err := websocket.DefaultDialer.Dial(relayURL(a), http.Header{relayHeader: {b.relayCredential(a.node)}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = conn.Close() })
	user := Object{"name": "Alice", "status": "online", "position": Object{"x": 0, "y": 0}}
	if got := request(t, conn, "world:join", "loop", Object{"instanceId": "room", "token": memberGrant(t, b, "room", "alice"), "user": user}); got["code"] != "instance_unavailable" {
		t.Fatalf("relayed join to a room elsewhere: %v", got)
	}
	if a.relayCount() != 0 {
		t.Fatal("a relayed connection was relayed again")
	}
}

// 毎秒 240 件の上限は、クライアントが繋いだ Pod だけが数える。owner でも数えると窓の区切りがずれて二重に絞る。
func TestRateLimitIsCountedOnlyWhereTheClientConnects(t *testing.T) {
	c := newCluster()
	a, b := c.pod(t, "node-a"), c.pod(t, "node-b")
	provision(t, a, "room")
	a.maintain()
	burst := func(conn *websocket.Conn, n int) (limited int) {
		t.Helper()
		for i := range n {
			if err := conn.WriteJSON(Frame{Event: "media:timeline:get", ID: fmt.Sprint("r", i), Data: encoded(Object{"sessionId": "s"})}); err != nil {
				t.Fatal(err)
			}
		}
		for range n {
			var f Frame
			for f.ReplyTo == "" {
				_ = conn.SetReadDeadline(time.Now().Add(5 * time.Second))
				if err := conn.ReadJSON(&f); err != nil {
					t.Fatal(err)
				}
			}
			if out, _ := object(f.Data); out["error"] == "rate limit exceeded" {
				limited++
			}
		}
		return limited
	}

	relayed, out := joinWith(t, b.http, "room", memberGrant(t, a, "room", "alice"))
	joined(t, out)
	// 入室の 1 件も同じ窓に入りうる。窓をまたげば絞られる数は減る
	if limited := burst(relayed, 260); limited == 0 || limited > 260+1-240 {
		t.Fatalf("relaying pod limited %d of 260", limited)
	}

	direct, _, err := websocket.DefaultDialer.Dial(relayURL(a), http.Header{relayHeader: {b.relayCredential(a.node)}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = direct.Close() })
	user := Object{"name": "Bob", "status": "online", "position": Object{"x": 0, "y": 0}}
	joined(t, request(t, direct, "world:join", "join", Object{"instanceId": "room", "token": memberGrant(t, a, "room", "bob"), "user": user}))
	if limited := burst(direct, 260); limited != 0 {
		t.Fatalf("owner limited %d frames that the relaying pod had already counted", limited)
	}
}

func TestRelayKeepsTheReadLimitOfTheClientConnection(t *testing.T) {
	c := newCluster()
	a, b := c.pod(t, "node-a"), c.pod(t, "node-b")
	provision(t, a, "room")
	a.maintain()
	alice, out := joinWith(t, b.http, "room", memberGrant(t, a, "room", "alice"))
	joined(t, out)
	if err := alice.WriteJSON(Frame{Event: "cursor:move", Data: encoded(Object{"pad": strings.Repeat("x", 71<<10)})}); err != nil {
		t.Fatal(err)
	}
	expectClosed(t, alice, "")
	// 中継元が閉じたら owner 側の接続も閉じ、参加者は猶予のあと抜ける
	eventually(t, "the owner kept the participant", func() bool { return len(members(a.Server, "room")) == 0 })
	eventually(t, "the relay was left open", func() bool { return b.relayCount() == 0 })
}

func TestManagementAPIRejectsAnotherGeneration(t *testing.T) {
	c := newCluster()
	a := c.node(t, "node-a", false)
	r := provision(t, a, "room")
	a.maintain()
	at := func(gen string, epoch int64) string { return fmt.Sprintf("?gen=%s&epoch=%d", gen, epoch) }
	current, old := at(r.gen, r.epoch), at(r.gen, r.epoch+1)

	if code, out := call(t, a.http, "POST", "/instances/room/tickets"+current, Object{"userId": "alice"}, true); code != 200 || out["token"] == "" {
		t.Fatalf("ticket at the current generation: %d %v", code, out)
	}
	code, out := call(t, a.http, "POST", "/instances/room/tickets"+old, Object{"userId": "alice"}, true)
	if owner, _ := out["owner"].(map[string]any); code != 409 || owner["epoch"] != float64(r.epoch) || owner["node"] != "node-a" {
		t.Fatalf("ticket at another generation: %d %v", code, out)
	}
	if code, _ := call(t, a.http, "POST", "/instances/room/tickets?gen="+r.gen, Object{"userId": "alice"}, true); code != 400 {
		t.Fatalf("gen without epoch: %d", code)
	}
	if code, _ := call(t, a.http, "PUT", "/instances/room"+current, definition("room"), true); code != 200 {
		t.Fatalf("provision at the current generation: %d", code)
	}
	if code, _ := call(t, a.http, "PUT", "/instances/room"+old, definition("room"), true); code != 409 {
		t.Fatalf("provision at another generation: %d", code)
	}
	// 世代を指定した作成は部屋を作らない
	if code, _ := call(t, a.http, "PUT", "/instances/other"+current, definition("other"), true); code != 409 || a.room("other") != nil {
		t.Fatalf("provision with a generation created a room: %d", code)
	}
	if code, _ := call(t, a.http, "DELETE", "/instances/room"+old, nil, true); code != 409 || a.owned("room") != r {
		t.Fatalf("close at another generation: %d", code)
	}
	if code, _ := call(t, a.http, "DELETE", "/instances/room"+current, nil, true); code != 204 || a.room("room") != nil {
		t.Fatalf("close at the current generation: %d", code)
	}
}

// 世代を指定した作成は、部屋が fencing で捨てられた直後でも、新しい epoch の部屋を作らない。
// 世代の確認を provisioning のロックの外でしていたときは、確認の直後に捨てられると epoch=1 の要求で epoch=2 が作られた。
func TestProvisionWithGenerationNeverCreatesANewEpoch(t *testing.T) {
	c := newCluster()
	a := c.node(t, "node-a", false)
	r := provision(t, a, "room")
	stale := fmt.Sprintf("?gen=%s&epoch=%d", r.gen, r.epoch)

	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	a.discard(ctx, r, true)
	if code, _ := call(t, a.http, "PUT", "/instances/room"+stale, definition("room"), true); code != 409 || a.room("room") != nil {
		t.Fatalf("provision at a discarded generation: %d (room=%v)", code, a.room("room"))
	}

	// 古い世代の作成を何本も並べて投げている間に部屋を捨てても、古い世代の要求からは部屋が生まれない
	for i := 0; i < 30; i++ {
		fresh := provision(t, a, "race")
		old := fmt.Sprintf("/instances/race?gen=%s&epoch=%d", fresh.gen, fresh.epoch)
		var wg sync.WaitGroup
		for w := 0; w < 8; w++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				for k := 0; k < 5; k++ {
					call(t, a.http, "PUT", old, definition("race"), true)
				}
			}()
		}
		time.Sleep(time.Duration(i%5) * time.Millisecond)
		a.discard(ctx, fresh, true)
		wg.Wait()
		if created := a.room("race"); created != nil {
			t.Fatalf("round %d: a request at epoch %d created epoch %d", i, fresh.epoch, created.epoch)
		}
	}
}

// Redis の Directory を共有する 2 つの Pod で、部屋の分散・中継・owner の停止のあとの入り直しを通しで確かめる（REDIS_URL があるときだけ）。
func TestRedisRouterAcrossPods(t *testing.T) {
	url := os.Getenv("REDIS_URL")
	if url == "" {
		t.Skip("REDIS_URL is not set")
	}
	client, err := coord.NewRedisClient(url, os.Getenv("REDIS_PASSWORD"))
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	prefix := "ubi:test:router:" + newID() + ":"
	t.Cleanup(func() {
		keys, _ := client.Keys(ctx, prefix+"*").Result()
		if len(keys) > 0 {
			_ = client.Del(ctx, keys...).Err()
		}
		_ = client.Close()
	})
	dir := coord.NewRedisDirectory(client, prefix)
	a, b, edge := startPod(t, dir, "node-a", nil), startPod(t, dir, "node-b", nil), startPod(t, dir, "node-c", nil)
	edge.maintain()
	spreadAndConverge(t, a, b)

	stale := memberGrant(t, a, "room-a", "dave")
	dave, out := joinWith(t, edge.http, "room-a", stale)
	joined(t, out)
	// owner の停止（SIGTERM）で割り当てを解放し、中継している接続も閉じる
	a.Close()
	expectClosed(t, dave, "instance:closing")
	next := provision(t, b, "room-a")
	if next.epoch != 2 {
		t.Fatalf("epoch = %d", next.epoch)
	}
	b.maintain()
	if _, out := joinWith(t, edge.http, "room-a", stale); out["code"] != "ticket_invalid" {
		t.Fatalf("stale ticket: %v", out)
	}
	joined(t, func() Object {
		_, out := joinWith(t, edge.http, "room-a", memberGrant(t, b, "room-a", "dave"))
		return out
	}())
}
