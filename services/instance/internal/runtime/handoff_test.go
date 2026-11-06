package runtime

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"slices"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/ubichill/ubichill/services/instance/internal/coord"
)

// elapse は時計を進めながら延長と heartbeat を回す（一度に進めるとリースが切れる）。
func (c *cluster) elapse(d time.Duration, nodes ...*node) {
	for d > 0 {
		step := min(testFencing.Interval, d)
		c.clock.Advance(step)
		d -= step
		for _, n := range nodes {
			n.maintain()
		}
	}
}

// expectQuiet は、後から送った要求の応答が届くまでに forbidden のイベントが届かないことを確かめる。
func expectQuiet(t *testing.T, c *websocket.Conn, forbidden ...string) {
	t.Helper()
	id := "barrier-" + newID()
	if err := c.WriteJSON(Frame{Event: "state:get", ID: id, Data: encoded(Object{"key": "barrier"})}); err != nil {
		t.Fatal(err)
	}
	_ = c.SetReadDeadline(time.Now().Add(3 * time.Second))
	for {
		var f Frame
		if err := c.ReadJSON(&f); err != nil {
			t.Fatal(err)
		}
		if slices.Contains(forbidden, f.Event) {
			t.Fatalf("unexpected %s: %s", f.Event, f.Data)
		}
		if f.ReplyTo == id {
			if out, _ := object(f.Data); out["success"] != true {
				t.Fatalf("barrier: %s", f.Data)
			}
			return
		}
	}
}

func entityIDs(r *Room) []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	ids := []string{}
	for _, e := range r.snapshot().Entities {
		ids = append(ids, str(e["id"]))
	}
	return ids
}

func stateOf(r *Room, key string) stateEntry {
	r.mu.Lock()
	defer r.mu.Unlock()
	if e := r.state[key]; e != nil {
		return *e
	}
	return stateEntry{}
}

func connected(r *Room) int { _, n := r.occupancy(); return n }

// testPeer は接続を持たない参加者（部屋に直接フレームを渡して応答を見る）。
func testPeer(user string) *peer {
	return &peer{out: make(chan Frame, 16), done: make(chan struct{}), userID: user}
}

// migrationScene は owner（a）の部屋に、別の Pod（edge）から中継されてきた alice と、a に直接繋いだ bob が居る状態を作る。
type migrationScene struct {
	alice, bob *websocket.Conn
	entities   []string
	state      stateEntry
	room       *Room
}

func setUpMigration(t *testing.T, a, edge *node) migrationScene {
	t.Helper()
	provision(t, a, "room")
	a.maintain()
	alice, out := joinWith(t, edge.http, "room", memberGrant(t, a, "room", "alice"))
	joined(t, out)
	bob, out := joinWith(t, a.http, "room", memberGrant(t, a, "room", "bob"))
	joined(t, out)
	receive(t, alice, "user:joined")
	first := createEntity(t, alice, Object{"by": "alice"})
	receive(t, bob, "entity:created")
	second := createEntity(t, bob, Object{"by": "bob"})
	receive(t, alice, "entity:created")
	for i, want := range []float64{0, 1} {
		if out := request(t, bob, "state:update", "s"+string(rune('0'+i)), stateUpdate("media", Object{"t": i}, want)); out["success"] != true {
			t.Fatalf("state: %v", out)
		}
		receive(t, alice, "state:changed")
	}
	room := a.room("room")
	return migrationScene{alice, bob, []string{first, second}, stateOf(room, "media"), room}
}

// 引っ越しの前後でエンティティ（順序）・共有状態（revision・updatedAt）が保たれ、中継されてきた接続も
// 直接繋いでいた接続も切れずに、次のフレームが新しい owner に届く。入退室は出ない。
func checkMigration(t *testing.T, a, b, edge *node, scene migrationScene, migrate func()) {
	t.Helper()
	migrate()
	moved := b.owned("room")
	if moved == nil || a.room("room") != nil {
		t.Fatalf("after the handoff: b=%v a=%v", moved, a.room("room"))
	}
	owner, held, err := b.dir.Owner(context.Background(), "room")
	if err != nil || !held || owner.Node != b.node || owner.Epoch != 2 {
		t.Fatalf("directory owner = %+v %v %v", owner, held, err)
	}
	if got := entityIDs(moved); !slices.Equal(got, scene.entities) {
		t.Fatalf("entities = %v, want %v", got, scene.entities)
	}
	if got := stateOf(moved, "media"); got.Revision != 2 || got.UpdatedAt != scene.state.UpdatedAt || string(got.Value) != string(scene.state.Value) || got.UpdatedBy != "bob" {
		t.Fatalf("state = %+v, want %+v", got, scene.state)
	}
	eventually(t, "the participants did not come back to the new owner", func() bool { return connected(moved) == 2 })
	if got := members(b.Server, "room"); !slices.Equal(got, []string{"alice", "bob"}) {
		t.Fatalf("members = %v", got)
	}
	// 中継元（edge）は繋ぎ替え、元の owner（a）は bob の中継に変わった
	if edge.relayCount() != 1 || a.relayCount() != 1 {
		t.Fatalf("relays: edge=%d a=%d", edge.relayCount(), a.relayCount())
	}
	for _, c := range []*websocket.Conn{scene.alice, scene.bob} {
		expectQuiet(t, c, "user:joined", "user:left", "session:replaced", "instance:closing", migrateEvent)
	}
	id := createEntity(t, scene.alice, Object{"after": true})
	if f := receive(t, scene.bob, "entity:created"); !json.Valid(f.Data) || entityIn(b.Server, "room", id) == nil {
		t.Fatalf("the next frame did not reach the new owner: %s", f.Data)
	}
	if out := request(t, scene.bob, "state:update", "s-after", stateUpdate("media", Object{"t": 2}, float64(2))); out["success"] != true {
		t.Fatalf("state after the handoff: %v", out)
	}
	receive(t, scene.alice, "state:changed")

	// 元の owner の部屋は、付け替えのあとに変更を受けない（fencing）
	p := testPeer("bob")
	scene.room.handle(p, Frame{Event: "entity:create", ID: "late", Data: encoded(Object{"type": "pen:stroke", "transform": fullTransform(), "data": Object{}})})
	if out, _ := object((<-p.out).Data); out["code"] != "migrating" || len(entityIDs(scene.room)) != 2 {
		t.Fatalf("the old owner accepted a change: %v", out)
	}
}

func TestMigrationMovesTheOwnerWithoutReconnecting(t *testing.T) {
	c := newCluster()
	a, b, edge := c.pod(t, "node-a"), c.pod(t, "node-b"), c.pod(t, "node-c")
	for _, n := range []*node{a, b, edge} {
		n.maintain()
	}
	scene := setUpMigration(t, a, edge)
	// 接続の少ない b が選ばれる（edge は alice を中継している）
	edge.maintain()
	checkMigration(t, a, b, edge, scene, func() {
		if err := a.migrate(context.Background(), scene.room); err != nil {
			t.Fatal(err)
		}
	})
	// 退出は新しい owner に届き、ほかの参加者に user:left が出る
	if out := request(t, scene.bob, "world:leave", "bye", nil); out["success"] != true {
		t.Fatalf("leave: %v", out)
	}
	if f := receive(t, scene.alice, "user:left"); string(f.Data) != `"bob"` {
		t.Fatalf("user:left = %s", f.Data)
	}
}

func TestRedisMigrationAcrossPods(t *testing.T) {
	url := os.Getenv("REDIS_URL")
	if url == "" {
		t.Skip("REDIS_URL is not set")
	}
	client, err := coord.NewRedisClient(url, os.Getenv("REDIS_PASSWORD"))
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	prefix := "ubi:test:handoff:" + newID() + ":"
	t.Cleanup(func() {
		keys, _ := client.Keys(ctx, prefix+"*").Result()
		if len(keys) > 0 {
			_ = client.Del(ctx, keys...).Err()
		}
		_ = client.Close()
	})
	dir := coord.NewRedisDirectory(client, prefix)
	a, b, edge := startPod(t, dir, "node-a", nil), startPod(t, dir, "node-b", nil), startPod(t, dir, "node-c", nil)
	for _, n := range []*node{a, b, edge} {
		n.maintain()
	}
	scene := setUpMigration(t, a, edge)
	edge.maintain()
	checkMigration(t, a, b, edge, scene, func() {
		if err := a.migrate(ctx, scene.room); err != nil {
			t.Fatal(err)
		}
	})
}

// Drain は 3 時間（MigrateAfter）未満の部屋を待ち、過ぎたら引っ越す。引っ越したあとも、直接繋いでいる bob を
// 中継している間は終わらない。
func TestDrainMovesOldRoomsAndWaitsForDirectClients(t *testing.T) {
	c := newCluster()
	a, b, edge := c.pod(t, "node-a"), c.pod(t, "node-b"), c.pod(t, "node-c")
	all := []*node{a, b, edge}
	for _, n := range all {
		n.maintain()
	}
	scene := setUpMigration(t, a, edge)
	provision(t, a, "empty")
	edge.maintain()

	c.elapse(3*time.Hour-testFencing.Interval, all...)
	a.beginDrain()
	if r := a.nextMigration(); r != nil {
		t.Fatalf("a room younger than 3h was chosen: %s", r.definition.ID)
	}
	c.elapse(testFencing.Interval, all...)
	if r := a.nextMigration(); r != scene.room {
		t.Fatalf("next migration = %v", r)
	}

	drained := make(chan struct{})
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		a.Drain(ctx)
		close(drained)
	}()
	eventually(t, "the room was not moved", func() bool { return b.owned("room") != nil })
	eventually(t, "the participants did not come back", func() bool { return connected(b.owned("room")) == 2 })
	// 空の部屋は引っ越さない（掃除が閉じるか、Close が解放する）
	if a.owned("empty") == nil || b.room("empty") != nil {
		t.Fatal("an empty room was moved")
	}
	expectQuiet(t, scene.alice, "user:joined", "user:left")
	select {
	case <-drained:
		t.Fatal("drain ended while a direct client was relayed")
	case <-time.After(300 * time.Millisecond):
	}
	_ = scene.bob.Close()
	select {
	case <-drained:
	case <-time.After(3 * time.Second):
		t.Fatal("drain did not end after the direct client left")
	}
	a.Close()
	// 中継されてきた alice は edge から新しい owner へ繋がったまま
	createEntity(t, scene.alice, Object{"after": "drain"})
}

// 凍結の間、変更系の要求は再試行できるエラー（code: migrating）になり、状態は変わらない。取りやめれば元どおり動く。
func TestFrozenRoomRejectsChangesWithARetryableError(t *testing.T) {
	c := newCluster()
	a := c.pod(t, "node-a")
	r := provision(t, a, "room")
	a.maintain()
	bob, out := joinWith(t, a.http, "room", memberGrant(t, a, "room", "bob"))
	joined(t, out)
	carol, out := joinWith(t, a.http, "room", memberGrant(t, a, "room", "carol"))
	joined(t, out)
	if _, ok := r.freeze(); !ok {
		t.Fatal("freeze")
	}
	if _, ok := r.freeze(); ok {
		t.Fatal("a frozen room was frozen twice")
	}
	for _, tc := range []struct {
		event string
		data  any
	}{
		{"entity:create", Object{"type": "pen:stroke", "transform": fullTransform(), "data": Object{}}},
		{"state:update", stateUpdate("k", 1, 0)},
		{"status:update", "busy"},
	} {
		if out := request(t, bob, tc.event, "frozen-"+tc.event, tc.data); out["code"] != "migrating" {
			t.Fatalf("%s while frozen: %v", tc.event, out)
		}
	}
	if _, out := joinWith(t, a.http, "room", memberGrant(t, a, "room", "dave")); out["code"] != "instance_unavailable" {
		t.Fatalf("join while frozen: %v", out)
	}
	// 凍結の間に切れた参加者は、猶予を数えずに残る（引っ越し先が数える）
	_ = carol.Close()
	time.Sleep(100 * time.Millisecond)
	if got := members(a.Server, "room"); !slices.Equal(got, []string{"bob", "carol"}) {
		t.Fatalf("members while frozen = %v", got)
	}
	if len(entityIDs(r)) != 0 || stateOf(r, "k").Revision != 0 {
		t.Fatal("a frozen room changed")
	}
	r.thaw()
	createEntity(t, bob, Object{})
	eventually(t, "the member who left during the freeze stayed after thawing", func() bool {
		return slices.Equal(members(a.Server, "room"), []string{"bob"})
	})
	receive(t, bob, "user:left")
}

// 準備だけして確定しなかった引っ越しは、先が期限に捨てる。付け替えだけ済んで確定が届かなければ、先が自分で引き取る
// （owner の居ない隙間に、初期状態で作り直させない）。
func TestUnconfirmedHandoffIsDroppedOrTakenOver(t *testing.T) {
	c := newCluster()
	a, b := c.pod(t, "node-a"), c.pod(t, "node-b")
	b.handoffTimeout = 100 * time.Millisecond
	for _, n := range []*node{a, b} {
		n.maintain()
	}
	r := provision(t, a, "room")
	alice, out := joinWith(t, a.http, "room", memberGrant(t, a, "room", "alice"))
	joined(t, out)
	createEntity(t, alice, Object{})
	to := handoffTargets(a.node, mustNodes(t, a))[0]
	prepare := func() string {
		t.Helper()
		snapshot, ok := r.freeze()
		if !ok {
			t.Fatal("freeze")
		}
		var prepared struct {
			Token string `json:"token"`
		}
		if code, err := a.sendHandoff(context.Background(), to, "room", handoffRequest{Phase: "prepare", From: a.node, Snapshot: snapshot}, &prepared); err != nil || code != 200 {
			t.Fatalf("prepare: %d %v", code, err)
		}
		return prepared.Token
	}

	prepare()
	if !b.awaiting("room") || b.room("room") != nil {
		t.Fatal("prepare installed the room")
	}
	eventually(t, "an unconfirmed prepare was kept", func() bool { return !b.awaiting("room") })
	if b.room("room") != nil {
		t.Fatal("an unconfirmed prepare became a room")
	}
	if owner, _, _ := a.dir.Owner(context.Background(), "room"); owner.Node != a.node {
		t.Fatalf("owner = %+v", owner)
	}
	r.thaw()

	token := prepare()
	gen, _, from := r.lease()
	if _, ok, err := a.dir.Transfer(context.Background(), "room", from, b.node, token, gen, testFencing.TTL); err != nil || !ok {
		t.Fatalf("transfer: %v %v", ok, err)
	}
	// 確定の前に backend の作成が届いても、割り当て直さず（epoch 3 にせず）引っ越してきた中身を引き取る
	got, err := b.Provision(definition("room"))
	if err != nil || got.epoch != 2 || len(entityIDs(got)) != 1 {
		t.Fatalf("provision during the handoff: %v %v", got, err)
	}
	if b.awaiting("room") {
		t.Fatal("the prepare remained after it was taken over")
	}

	// 付け替えのあと確定が届かないまま期限が来ても、先が自分で引き取る
	c2 := newCluster()
	x, y := c2.pod(t, "node-x"), c2.pod(t, "node-y")
	y.handoffTimeout = 100 * time.Millisecond
	x.maintain()
	y.maintain()
	rx := provision(t, x, "room")
	snapshot, _ := rx.freeze()
	var prepared struct {
		Token string `json:"token"`
	}
	if code, err := x.sendHandoff(context.Background(), handoffTargets(x.node, mustNodes(t, x))[0], "room", handoffRequest{Phase: "prepare", From: x.node, Snapshot: snapshot}, &prepared); err != nil || code != 200 {
		t.Fatalf("prepare: %d %v", code, err)
	}
	gen, _, from = rx.lease()
	if _, ok, _ := x.dir.Transfer(context.Background(), "room", from, y.node, prepared.Token, gen, testFencing.TTL); !ok {
		t.Fatal("transfer")
	}
	eventually(t, "the target did not take over a transferred room", func() bool { return y.owned("room") != nil })
}

// 確定を断られたら（先が準備を捨てていた）、元の Pod が先の token で取り戻して凍結を解く。
func TestRefusedCommitTakesTheRoomBack(t *testing.T) {
	c := newCluster()
	a, b := c.pod(t, "node-a"), c.pod(t, "node-b")
	for _, n := range []*node{a, b} {
		n.maintain()
	}
	r := provision(t, a, "room")
	bob, out := joinWith(t, a.http, "room", memberGrant(t, a, "room", "bob"))
	joined(t, out)
	to := handoffTargets(a.node, mustNodes(t, a))[0]
	snapshot, _ := r.freeze()
	var prepared struct {
		Token string `json:"token"`
	}
	if code, err := a.sendHandoff(context.Background(), to, "room", handoffRequest{Phase: "prepare", From: a.node, Snapshot: snapshot}, &prepared); err != nil || code != 200 {
		t.Fatalf("prepare: %d %v", code, err)
	}
	gen, _, from := r.lease()
	at, ok, _ := a.dir.Transfer(context.Background(), "room", from, b.node, prepared.Token, gen, testFencing.TTL)
	if !ok {
		t.Fatal("transfer")
	}
	b.dropHandoff("room", nil)
	if code, err := a.sendHandoff(context.Background(), to, "room", handoffRequest{Phase: "commit"}, nil); err != nil || code != 409 {
		t.Fatalf("commit without a prepare: %d %v", code, err)
	}
	if !a.reclaim(context.Background(), r, at) {
		t.Fatal("reclaim")
	}
	r.thaw()
	owner, _, _ := a.dir.Owner(context.Background(), "room")
	if owner.Node != a.node || owner.Epoch != 3 || r.epochNow() != 3 {
		t.Fatalf("owner after reclaim = %+v (room epoch %d)", owner, r.epochNow())
	}
	a.maintain()
	if a.owned("room") != r {
		t.Fatal("the reclaimed room was not renewed")
	}
	createEntity(t, bob, Object{})
}

// 宛先の違う・管理トークンの無い・中身の壊れた準備は受け付けない。draining のノードは準備を断る。
func TestHandoffEndpointRejectsBadRequests(t *testing.T) {
	c := newCluster()
	a, b := c.pod(t, "node-a"), c.pod(t, "node-b")
	for _, n := range []*node{a, b} {
		n.maintain()
	}
	r := provision(t, a, "room")
	snapshot, _ := r.freeze()
	to := handoffTargets(a.node, mustNodes(t, a))[0]
	send := func(body handoffRequest) int {
		code, err := a.sendHandoff(context.Background(), to, "room", body, nil)
		if err != nil {
			t.Fatal(err)
		}
		return code
	}
	if code, _ := call(t, b.http, "POST", "/instances/room/handoff", handoffRequest{Phase: "prepare", To: b.node, Snapshot: snapshot}, false); code != 401 {
		t.Fatalf("without the admin token: %d", code)
	}
	if code, _ := call(t, b.http, "POST", "/instances/room/handoff", handoffRequest{Phase: "prepare", To: a.node, Snapshot: snapshot}, true); code != 421 {
		t.Fatalf("addressed to another node: %d", code)
	}
	broken := *snapshot
	broken.State = []stateEntry{{Key: "k", Value: json.RawMessage(`1`), Revision: 0}}
	if code := send(handoffRequest{Phase: "prepare", Snapshot: &broken}); code != 409 {
		t.Fatalf("broken state: %d", code)
	}
	crowd := *snapshot
	crowd.Members = []handoffMember{{ID: "a", User: Object{}}, {ID: "b", User: Object{}}, {ID: "c", User: Object{}}, {ID: "d", User: Object{}}}
	if code := send(handoffRequest{Phase: "prepare", Snapshot: &crowd}); code != 409 {
		t.Fatalf("more members than maxUsers: %d", code)
	}
	other := *snapshot
	other.Definition.ID = "other"
	if code := send(handoffRequest{Phase: "prepare", Snapshot: &other}); code != 400 {
		t.Fatalf("snapshot of another room: %d", code)
	}
	if code := send(handoffRequest{Phase: "commit"}); code != 409 {
		t.Fatalf("commit without a prepare: %d", code)
	}
	b.beginDrain()
	if code := send(handoffRequest{Phase: "prepare", Snapshot: snapshot}); code != 503 {
		t.Fatalf("prepare on a draining node: %d", code)
	}
	if b.awaiting("room") {
		t.Fatal("a rejected prepare was kept")
	}
}

// 引っ越し先が無ければ凍結を解き、部屋はそのまま動く（あとで試し直す）。
func TestMigrationWithoutATargetThaws(t *testing.T) {
	c := newCluster()
	a, b := c.pod(t, "node-a"), c.pod(t, "node-b")
	r := provision(t, a, "room")
	bob, out := joinWith(t, a.http, "room", memberGrant(t, a, "room", "bob"))
	joined(t, out)
	b.beginDrain()
	a.maintain()
	if err := a.migrate(context.Background(), r); !errors.Is(err, errNoHandoffTarget) {
		t.Fatalf("migrate without a target: %v", err)
	}
	if r.isMigrating() || a.owned("room") != r {
		t.Fatal("the room stayed frozen")
	}
	createEntity(t, bob, Object{})
}

// Drain の期限の DisconnectNotice 前に、直接繋いでいるクライアントへ server:notice を送る。中継されてきた接続には送らない。
func TestDrainNoticesDirectClientsBeforeTheDeadline(t *testing.T) {
	c := newCluster()
	a := startPodWith(t, c.dir, "node-a", c.clock.Now, func(config *Config) { config.DisconnectNotice = 300 * time.Millisecond })
	edge := c.pod(t, "node-c")
	provision(t, a, "room")
	a.maintain()
	edge.maintain()
	bob, out := joinWith(t, a.http, "room", memberGrant(t, a, "room", "bob"))
	joined(t, out)
	alice, out := joinWith(t, edge.http, "room", memberGrant(t, a, "room", "alice"))
	joined(t, out)

	ctx, cancel := context.WithTimeout(context.Background(), 800*time.Millisecond)
	defer cancel()
	deadline, _ := ctx.Deadline()
	start := time.Now()
	go a.Drain(ctx)
	f := receive(t, bob, "server:notice")
	if elapsed := time.Since(start); elapsed < 400*time.Millisecond {
		t.Fatalf("notice came %v after the drain began (too early)", elapsed)
	}
	var notice struct {
		Kind string `json:"kind"`
		At   int64  `json:"at"`
	}
	if json.Unmarshal(f.Data, &notice) != nil || notice.Kind != "disconnect" || notice.At != deadline.UnixMilli() {
		t.Fatalf("notice = %s (deadline %d)", f.Data, deadline.UnixMilli())
	}
	expectQuiet(t, alice, "server:notice")
}

func TestHandoffTargetsPreferTheLeastConnectedReadyNode(t *testing.T) {
	nodes := map[string]coord.NodeInfo{
		"self":     {Addr: "s", State: coord.NodeReady, Capacity: 10},
		"busy":     {Addr: "b", State: coord.NodeReady, Connections: 50, Capacity: 10},
		"idle":     {Addr: "i", State: coord.NodeReady, Connections: 3, Rooms: 2, Capacity: 10},
		"idle2":    {Addr: "j", State: coord.NodeReady, Connections: 3, Rooms: 1, Capacity: 10},
		"draining": {Addr: "d", State: coord.NodeDraining, Capacity: 10},
		"full":     {Addr: "f", State: coord.NodeReady, Rooms: 10, Capacity: 10},
		"noaddr":   {State: coord.NodeReady, Capacity: 10},
	}
	got := []string{}
	for _, c := range handoffTargets("self", nodes) {
		got = append(got, c.node)
	}
	if !slices.Equal(got, []string{"idle2", "idle", "busy"}) {
		t.Fatalf("targets = %v", got)
	}
}

func TestRelayQueueOverflowsWhileSwitching(t *testing.T) {
	l := &relayLink{switching: true}
	for range maxRelayQueue {
		if err := l.forward([]byte("{}")); err != nil {
			t.Fatal(err)
		}
	}
	if err := l.forward([]byte("{}")); !errors.Is(err, errRelayQueueFull) {
		t.Fatalf("overflow: %v", err)
	}
}

func mustNodes(t *testing.T, n *node) map[string]coord.NodeInfo {
	t.Helper()
	nodes, err := n.dir.Nodes(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	return nodes
}
