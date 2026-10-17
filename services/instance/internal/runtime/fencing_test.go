package runtime

import (
	"context"
	"errors"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/redis/go-redis/v9"
	"github.com/ubichill/ubichill/services/instance/internal/coord"
)

type fakeClock struct {
	mu  sync.Mutex
	now time.Time
}

func (c *fakeClock) Now() time.Time { c.mu.Lock(); defer c.mu.Unlock(); return c.now }
func (c *fakeClock) Advance(d time.Duration) {
	c.mu.Lock()
	c.now = c.now.Add(d)
	c.mu.Unlock()
}

// partitioned は 1 つのノードから見た Directory。down の間はそのノードだけ Redis に届かない。
type partitioned struct {
	coord.Directory
	down atomic.Bool
}

var errPartitioned = errors.New("partitioned")

func (p *partitioned) fail() error {
	if p.down.Load() {
		return errPartitioned
	}
	return nil
}
func (p *partitioned) ClusterGen(ctx context.Context) (string, error) {
	if err := p.fail(); err != nil {
		return "", err
	}
	return p.Directory.ClusterGen(ctx)
}
func (p *partitioned) Heartbeat(ctx context.Context, node string, info coord.NodeInfo, ttl time.Duration) error {
	if err := p.fail(); err != nil {
		return err
	}
	return p.Directory.Heartbeat(ctx, node, info, ttl)
}
func (p *partitioned) Assign(ctx context.Context, room, node, gen string, ttl time.Duration) (coord.Assignment, bool, error) {
	if err := p.fail(); err != nil {
		return coord.Assignment{}, false, err
	}
	return p.Directory.Assign(ctx, room, node, gen, ttl)
}
func (p *partitioned) Renew(ctx context.Context, room, token string, ttl time.Duration) (bool, error) {
	if err := p.fail(); err != nil {
		return false, err
	}
	return p.Directory.Renew(ctx, room, token, ttl)
}
func (p *partitioned) Release(ctx context.Context, room, token string) (bool, error) {
	if err := p.fail(); err != nil {
		return false, err
	}
	return p.Directory.Release(ctx, room, token)
}
func (p *partitioned) Retire(ctx context.Context, room, token string, ttl time.Duration) (bool, error) {
	if err := p.fail(); err != nil {
		return false, err
	}
	return p.Directory.Retire(ctx, room, token, ttl)
}
func (p *partitioned) PublishPresence(ctx context.Context, rooms []coord.RoomPresence, ttl time.Duration) error {
	if err := p.fail(); err != nil {
		return err
	}
	return p.Directory.PublishPresence(ctx, rooms, ttl)
}

// cluster は 1 つの Directory と時計を共有するノードの集まり。延長は自動で回さず、maintain を呼んで進める。
type cluster struct {
	clock *fakeClock
	dir   *coord.MemoryDirectory
}

type node struct {
	*Server
	http *httptest.Server
	link *partitioned
}

var testFencing = Fencing{TTL: 15 * time.Second, Margin: 5 * time.Second, Interval: 5 * time.Second, Retry: time.Second, Timeout: time.Second}

func newCluster() *cluster {
	clock := &fakeClock{now: time.Unix(1_700_000_000, 0)}
	return &cluster{clock: clock, dir: coord.NewMemoryDirectory(clock.Now)}
}

func (c *cluster) node(t *testing.T, name string, guests bool) *node {
	t.Helper()
	link := &partitioned{Directory: c.dir}
	s := newServer(Config{
		AdminToken: strings.Repeat("a", 32), Guests: guests, Grace: 20 * time.Millisecond,
		Directory: link, Node: name, Addr: name + ":3002", Fencing: testFencing, Clock: c.clock.Now,
	})
	h := httptest.NewServer(s.Handler())
	t.Cleanup(func() { s.Close(); h.Close() })
	return &node{s, h, link}
}

func (n *node) maintain() bool { return n.Server.maintain(context.Background()) }

func dial(t *testing.T, h *httptest.Server) *websocket.Conn {
	t.Helper()
	c, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(h.URL, "http")+"/realtime/v1/ws", nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = c.Close() })
	return c
}

// joinWith は任意のチケットで入室し、応答を返す。
func joinWith(t *testing.T, h *httptest.Server, room, token string) (*websocket.Conn, Object) {
	t.Helper()
	c := dial(t, h)
	if err := c.WriteJSON(Frame{Event: "world:join", ID: "join", Data: encoded(Object{
		"instanceId": room, "token": token,
		"user": Object{"name": "Alice", "status": "online", "position": Object{"x": 0, "y": 0}},
	})}); err != nil {
		t.Fatal(err)
	}
	out, _ := object(receive(t, c, "join").Data)
	return c, out
}

func memberGrant(t *testing.T, n *node, room, user string) string {
	t.Helper()
	code, out := call(t, n.http, "POST", "/instances/"+room+"/tickets", Object{"userId": user}, true)
	if code != 200 {
		t.Fatalf("ticket: %d %v", code, out)
	}
	return str(out["token"])
}

func provision(t *testing.T, n *node, room string) *Room {
	t.Helper()
	r, err := n.Provision(definition(room))
	if err != nil {
		t.Fatalf("provision %s on %s: %v", room, n.node, err)
	}
	return r
}

func TestRenewalKeepsTheRoomAndOneMissedRenewalIsTolerated(t *testing.T) {
	c := newCluster()
	a := c.node(t, "node-a", false)
	r := provision(t, a, "room")
	for range 12 {
		c.clock.Advance(testFencing.Interval)
		if !a.maintain() {
			t.Fatal("renewal failed")
		}
	}
	// 1 回だけ延長に失敗しても、期限（送った時刻 + 10 秒）の前に試し直して成功すれば止まらない
	a.link.down.Store(true)
	c.clock.Advance(testFencing.Interval)
	if a.maintain() {
		t.Fatal("maintain reported success while partitioned")
	}
	a.link.down.Store(false)
	c.clock.Advance(testFencing.Retry)
	if !a.maintain() {
		t.Fatal("retry failed")
	}
	if a.owned("room") != r || r.epoch != 1 {
		t.Fatalf("room was replaced or lost (epoch %d)", r.epoch)
	}
}

func TestOldOwnerStopsBeforeNewOwnerAcquires(t *testing.T) {
	c := newCluster()
	a := c.node(t, "node-a", false)
	b := c.node(t, "node-b", false)
	start := c.clock.Now()
	old := provision(t, a, "room")
	a.maintain()
	alice, out := joinWith(t, a.http, "room", memberGrant(t, a, "room", "alice"))
	if out["success"] != true {
		t.Fatalf("join: %v", out)
	}
	if code, out := call(t, b.http, "PUT", "/instances/room", definition("room"), true); code != 409 {
		t.Fatalf("another node took a live room: %d %v", code, out)
	}

	// A だけ Redis から切り離す。延長が届かないまま時間が進む
	a.link.down.Store(true)
	for range 9 {
		c.clock.Advance(time.Second)
		a.maintain()
	}
	if got := request(t, alice, "entity:create", "before", Object{"type": "pen:stroke", "transform": fullTransform(), "data": Object{}}); got["success"] != true {
		t.Fatalf("mutation refused before the deadline: %v", got)
	}
	// 延長の周期を待たずに、期限（送った時刻 + TTL − 余裕）を過ぎた最初の操作で止まる
	c.clock.Advance(time.Second)
	if got := request(t, alice, "entity:create", "after", Object{"type": "pen:stroke", "transform": fullTransform(), "data": Object{}}); got["success"] != false {
		t.Fatalf("mutation accepted after the deadline: %v", got)
	}
	expectClosed(t, alice, "instance:closing")
	stopped := c.clock.Now()
	if _, out := joinWith(t, a.http, "room", a.sign(memberTicket("room"))); out["code"] != "instance_unavailable" {
		t.Fatalf("join after self-stop: %v", out)
	}

	var acquired time.Time
	var next *Room
	for range 30 {
		a.maintain()
		if r, err := b.Provision(definition("room")); err == nil {
			acquired, next = c.clock.Now(), r
			break
		}
		c.clock.Advance(time.Second)
	}
	if next == nil {
		t.Fatal("the new owner never acquired the room")
	}
	if !stopped.Before(acquired) || acquired.Sub(stopped) < testFencing.Margin {
		t.Fatalf("old owner stopped at +%v, new owner acquired at +%v (margin %v)", stopped.Sub(start), acquired.Sub(start), testFencing.Margin)
	}
	if next.epoch != old.epoch+1 || next.gen != old.gen {
		t.Fatalf("epoch %d → %d", old.epoch, next.epoch)
	}
	if a.room("room") != nil {
		t.Fatal("old owner kept the room")
	}

	// 旧 owner が戻っても、古い token の延長・解放は新しい owner に効かない
	a.link.down.Store(false)
	ctx := context.Background()
	if ok, _ := c.dir.Renew(ctx, "room", old.token, testFencing.TTL); ok {
		t.Fatal("old token renewed the new owner's lease")
	}
	if ok, _ := c.dir.Release(ctx, "room", old.token); ok {
		t.Fatal("old token released the new owner's lease")
	}
	a.maintain()
	if owner, ok, _ := c.dir.Owner(ctx, "room"); !ok || owner.Node != "node-b" || owner.Token != next.token {
		t.Fatalf("new owner lost the room: %+v", owner)
	}
	if b.owned("room") != next {
		t.Fatal("new owner's room is not usable")
	}
}

func TestLosingTheTokenStopsTheRoomImmediately(t *testing.T) {
	c := newCluster()
	a := c.node(t, "node-a", false)
	b := c.node(t, "node-b", false)
	r := provision(t, a, "room")
	alice, _ := joinWith(t, a.http, "room", memberGrant(t, a, "room", "alice"))
	// 期限の前でも、延長が token 不一致で失敗したら（他のノードが持ち主）即座に止める
	if ok, _ := c.dir.Release(context.Background(), "room", r.token); !ok {
		t.Fatal("release")
	}
	provision(t, b, "room")
	c.clock.Advance(time.Second)
	a.maintain()
	if a.room("room") != nil {
		t.Fatal("room survived a lost token")
	}
	expectClosed(t, alice, "instance:closing")
}

func TestTicketFromAnOldEpochIsRejectedByTheNewRoom(t *testing.T) {
	c := newCluster()
	a := c.node(t, "node-a", false)
	b := c.node(t, "node-b", false)
	provision(t, a, "room")
	stale := memberGrant(t, a, "room", "alice")
	a.link.down.Store(true)
	c.clock.Advance(testFencing.TTL)
	a.maintain()
	next := provision(t, b, "room")
	if next.epoch != 2 {
		t.Fatalf("epoch = %d", next.epoch)
	}
	// 署名鍵は共有なので署名は通る。世代が違うので取り直しを促す
	if _, out := joinWith(t, b.http, "room", stale); out["code"] != "ticket_invalid" {
		t.Fatalf("stale ticket: %v", out)
	}
	if _, out := joinWith(t, b.http, "room", memberGrant(t, b, "room", "alice")); out["success"] != true {
		t.Fatalf("fresh ticket: %v", out)
	}
}

func TestGuestResumeTokenKeepsTheIDOnlyWithinTheSameEpoch(t *testing.T) {
	c := newCluster()
	a := c.node(t, "node-a", true)
	first := provision(t, a, "room")
	guest := func(resume string) Object {
		t.Helper()
		body := Object{}
		if resume != "" {
			body["resumeToken"] = resume
		}
		code, out := call(t, a.http, "POST", "/instances/room/guest", body, false)
		if code != 200 {
			t.Fatalf("guest: %d %v", code, out)
		}
		return out
	}
	original := guest("")
	if again := guest(str(original["token"])); again["userId"] != original["userId"] {
		t.Fatalf("resume in the same epoch changed the ID: %v → %v", original["userId"], again["userId"])
	}
	if ok, _ := c.dir.Release(context.Background(), "room", first.token); !ok {
		t.Fatal("release")
	}
	a.maintain()
	if second := provision(t, a, "room"); second.epoch != first.epoch+1 {
		t.Fatalf("epoch %d → %d", first.epoch, second.epoch)
	}
	if resumed := guest(str(original["token"])); resumed["userId"] == original["userId"] {
		t.Fatal("a resume token from the previous epoch kept its guest ID")
	}
}

func TestClusterGenerationChangeDropsEveryRoom(t *testing.T) {
	c := newCluster()
	a := c.node(t, "node-a", false)
	first := provision(t, a, "room")
	provision(t, a, "other")
	a.maintain()
	stale := memberGrant(t, a, "room", "alice")
	alice, _ := joinWith(t, a.http, "room", memberGrant(t, a, "room", "alice"))
	bob, _ := joinWith(t, a.http, "other", memberGrant(t, a, "other", "bob"))
	c.dir.Wipe() // Redis が全部消えた
	a.maintain()
	if a.room("room") != nil || a.room("other") != nil {
		t.Fatal("rooms survived a generation change")
	}
	expectClosed(t, alice, "instance:closing")
	expectClosed(t, bob, "instance:closing")
	next := provision(t, a, "room")
	// epoch は 1 から数え直すが、gen が違うので前の世代のチケットは通らない
	if next.gen == first.gen || next.epoch != first.epoch {
		t.Fatalf("gen %q/%d → %q/%d", first.gen, first.epoch, next.gen, next.epoch)
	}
	if _, out := joinWith(t, a.http, "room", stale); out["code"] != "ticket_invalid" {
		t.Fatalf("ticket from the previous generation: %v", out)
	}
}

func TestConcurrentProvisionAcrossNodesHasOneOwner(t *testing.T) {
	c := newCluster()
	nodes := make([]*node, 10)
	for i := range nodes {
		nodes[i] = c.node(t, "node-"+string(rune('a'+i)), false)
	}
	var wg sync.WaitGroup
	codes := make([]int, len(nodes))
	for i, n := range nodes {
		wg.Go(func() { codes[i], _ = call(t, n.http, "PUT", "/instances/room", definition("room"), true) })
	}
	wg.Wait()
	owners := 0
	for i, n := range nodes {
		switch codes[i] {
		case 200:
			owners++
			if n.owned("room").epoch != 1 {
				t.Fatalf("epoch = %d", n.owned("room").epoch)
			}
		case 409:
			if n.room("room") != nil {
				t.Fatal("a node that lost the race kept a room")
			}
		default:
			t.Fatalf("unexpected status %d", codes[i])
		}
	}
	if owners != 1 {
		t.Fatalf("%d owners", owners)
	}
}

func TestConflictReportsTheOwnerAndOnlyTheOwnerCloses(t *testing.T) {
	c := newCluster()
	a := c.node(t, "node-a", false)
	b := c.node(t, "node-b", false)
	provision(t, a, "room")
	a.maintain()
	code, out := call(t, b.http, "PUT", "/instances/room", definition("room"), true)
	owner, _ := out["owner"].(map[string]any)
	if code != 409 || owner["node"] != "node-a" || owner["addr"] != "node-a:3002" || owner["alive"] != true || owner["epoch"] != float64(1) {
		t.Fatalf("conflict: %d %v", code, out)
	}
	if code, out := call(t, b.http, "DELETE", "/instances/room", nil, true); code != 409 {
		t.Fatalf("non-owner closed the room: %d %v", code, out)
	}
	if a.owned("room") == nil {
		t.Fatal("non-owner's close affected the owner")
	}
	if code, presence := call(t, a.http, "GET", "/instances/room", nil, true); code != 200 || presence["node"] != "node-a" || presence["epoch"] != float64(1) || presence["gen"] == "" {
		t.Fatalf("presence: %d %v", code, presence)
	}
	if code, _ := call(t, a.http, "DELETE", "/instances/room", nil, true); code != 204 {
		t.Fatalf("owner close: %d", code)
	}
	ctx := context.Background()
	if _, held, _ := c.dir.Owner(ctx, "room"); held {
		t.Fatal("close did not release the assignment")
	}
	if _, ok, _ := c.dir.Presence(ctx, "room"); ok {
		t.Fatal("close did not forget the presence")
	}
	// 閉じた部屋は別のノードでも retiredFor の間は作れない
	if _, err := b.Provision(definition("room")); !errors.Is(err, errRetired) {
		t.Fatalf("provision right after close: %v", err)
	}
	c.clock.Advance(retiredFor)
	if next := provision(t, b, "room"); next.epoch != 2 {
		t.Fatalf("epoch after close = %d", next.epoch)
	}
}

func TestPresenceAndHeartbeatAreWrittenByTheOwner(t *testing.T) {
	c := newCluster()
	a := c.node(t, "node-a", false)
	provision(t, a, "room")
	_, _ = joinWith(t, a.http, "room", memberGrant(t, a, "room", "alice"))
	a.maintain()
	ctx := context.Background()
	p, ok, _ := c.dir.Presence(ctx, "room")
	if !ok || len(p.Members) != 1 || p.Members[0] != "alice" || p.EmptySince != 0 {
		t.Fatalf("presence = %+v %v", p, ok)
	}
	info, alive, _ := c.dir.Node(ctx, "node-a")
	if !alive || info.Rooms != 1 || info.Connections != 1 || info.State != coord.NodeReady || info.Addr != "node-a:3002" {
		t.Fatalf("heartbeat = %+v %v", info, alive)
	}
	if rooms, _ := c.dir.Rooms(ctx); len(rooms) != 1 || rooms[0] != "room" {
		t.Fatalf("rooms = %v", rooms)
	}
}

func TestRoomIDThatCollidesWithTheEpochKeyIsRejected(t *testing.T) {
	c := newCluster()
	a := c.node(t, "node-a", false)
	if code, out := call(t, a.http, "PUT", "/instances/epoch:x", definition("epoch:x"), true); code != 400 {
		t.Fatalf("provision: %d %v", code, out)
	}
}

func TestShutdownReleasesAssignmentsForTheNextPod(t *testing.T) {
	c := newCluster()
	a := c.node(t, "node-a", false)
	b := c.node(t, "node-b", false)
	provision(t, a, "room")
	a.Close()
	// TTL を待たずに次の Pod が作り直せる
	if next := provision(t, b, "room"); next.epoch != 2 {
		t.Fatalf("epoch = %d", next.epoch)
	}
}

func TestRedisDownFailsAssignmentWithoutFallingBackToMemory(t *testing.T) {
	client := redis.NewClient(&redis.Options{Addr: "127.0.0.1:1", MaxRetries: -1, DialTimeout: 100 * time.Millisecond})
	t.Cleanup(func() { _ = client.Close() })
	s := newServer(Config{AdminToken: strings.Repeat("a", 32), Directory: coord.DirectoryFor(client, nil), Fencing: Fencing{Timeout: 500 * time.Millisecond}})
	h := httptest.NewServer(s.Handler())
	t.Cleanup(func() { s.Close(); h.Close() })
	if code, out := call(t, h, "PUT", "/instances/room", definition("room"), true); code != 503 {
		t.Fatalf("provision while Redis is down: %d %v", code, out)
	}
	if s.room("room") != nil {
		t.Fatal("a room was created without an assignment")
	}
	if _, out := joinWith(t, h, "room", s.sign(memberTicket("room"))); out["code"] != "instance_unavailable" {
		t.Fatalf("join: %v", out)
	}
	if s.maintain(context.Background()) {
		t.Fatal("maintain reported success while Redis is down")
	}
}

// Redis の Directory を 2 つのノードで共有し、割り当て・衝突・解放・世代の変化を通しで確かめる（REDIS_URL があるときだけ）。
func TestRedisDirectoryAcrossNodes(t *testing.T) {
	url := os.Getenv("REDIS_URL")
	if url == "" {
		t.Skip("REDIS_URL is not set")
	}
	client, err := coord.NewRedisClient(url, os.Getenv("REDIS_PASSWORD"))
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	prefix := "ubi:test:runtime:" + newID() + ":"
	t.Cleanup(func() {
		keys, _ := client.Keys(ctx, prefix+"*").Result()
		if len(keys) > 0 {
			_ = client.Del(ctx, keys...).Err()
		}
		_ = client.Close()
	})
	dir := coord.NewRedisDirectory(client, prefix)
	newNode := func(name string) *Server {
		s := newServer(Config{AdminToken: strings.Repeat("a", 32), Directory: dir, Node: name, Fencing: testFencing})
		t.Cleanup(s.Close)
		return s
	}
	a, b := newNode("node-a"), newNode("node-b")
	first, err := a.Provision(definition("room"))
	if err != nil {
		t.Fatal(err)
	}
	var elsewhere *ownedElsewhere
	if _, err := b.Provision(definition("room")); !errors.As(err, &elsewhere) || elsewhere.owner.Node != "node-a" {
		t.Fatalf("second node: %v", err)
	}
	if !a.maintain(ctx) || a.owned("room") != first {
		t.Fatal("renewal against Redis failed")
	}
	a.Close()
	next, err := b.Provision(definition("room"))
	if err != nil || next.epoch != first.epoch+1 {
		t.Fatalf("after the owner stopped: %v (epoch %d → %+v)", err, first.epoch, next)
	}
	if err := client.Del(ctx, prefix+"cluster:gen").Err(); err != nil {
		t.Fatal(err)
	}
	b.maintain(ctx)
	if b.room("room") != nil {
		t.Fatal("room survived a generation change")
	}
	again, err := b.Provision(definition("room"))
	if err != nil || again.gen == next.gen {
		t.Fatalf("after the generation change: %v", err)
	}
}
