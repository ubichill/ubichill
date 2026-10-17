package coord

import (
	"context"
	"errors"
	"fmt"
	"os"
	"slices"
	"sync"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
)

// testDirectory は契約テストを当てる実装と、期限を進める方法・全部消す方法の組。
type testDirectory struct {
	Directory
	advance func(time.Duration)
	wipe    func()
}

// testClock はメモリ実装の期限を進める時計。
type testClock struct {
	mu  sync.Mutex
	now time.Time
}

func (c *testClock) Now() time.Time { c.mu.Lock(); defer c.mu.Unlock(); return c.now }
func (c *testClock) Advance(d time.Duration) {
	c.mu.Lock()
	c.now = c.now.Add(d)
	c.mu.Unlock()
}

func TestMemoryDirectoryContract(t *testing.T) {
	runDirectoryContract(t, func(t *testing.T) testDirectory {
		clock := &testClock{now: time.Unix(1_700_000_000, 0)}
		m := NewMemoryDirectory(clock.Now)
		return testDirectory{m, clock.Advance, m.Wipe}
	})
}

// Redis 実装は REDIS_URL があるときだけ動かす（例: REDIS_URL=redis://127.0.0.1:6390 go test ./internal/coord/）。
func TestRedisDirectoryContract(t *testing.T) {
	client := testRedis(t)
	ctx := context.Background()
	runDirectoryContract(t, func(t *testing.T) testDirectory {
		prefix := "ubi:test:dir:" + newToken() + ":"
		wipe := func() {
			keys, _ := client.Keys(ctx, prefix+"*").Result()
			if len(keys) > 0 {
				_ = client.Del(ctx, keys...).Err()
			}
		}
		t.Cleanup(wipe)
		return testDirectory{NewRedisDirectory(client, prefix), time.Sleep, wipe}
	})
}

func testRedis(t *testing.T) *redis.Client {
	t.Helper()
	url := os.Getenv("REDIS_URL")
	if url == "" {
		t.Skip("REDIS_URL is not set")
	}
	client, err := NewRedisClient(url, os.Getenv("REDIS_PASSWORD"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = client.Close() })
	if err := client.Ping(context.Background()).Err(); err != nil {
		t.Fatalf("redis ping: %v", err)
	}
	return client
}

func runDirectoryContract(t *testing.T, newDirectory func(t *testing.T) testDirectory) {
	ctx := context.Background()
	const ttl = contractTTL
	gen := func(t *testing.T, d Directory) string {
		t.Helper()
		g, err := d.ClusterGen(ctx)
		if err != nil || g == "" {
			t.Fatalf("cluster gen: %q %v", g, err)
		}
		return g
	}
	assign := func(t *testing.T, d Directory, room, node string) (Assignment, bool) {
		t.Helper()
		a, created, err := d.Assign(ctx, room, node, gen(t, d), ttl)
		if err != nil {
			t.Fatalf("assign %s to %s: %v", room, node, err)
		}
		return a, created
	}

	t.Run("cluster gen is created once and stays", func(t *testing.T) {
		d := newDirectory(t)
		var wg sync.WaitGroup
		gens := make([]string, 10)
		for i := range gens {
			wg.Go(func() { gens[i], _ = d.ClusterGen(ctx) })
		}
		wg.Wait()
		if gens[0] == "" || slices.ContainsFunc(gens, func(g string) bool { return g != gens[0] }) {
			t.Fatalf("concurrent callers saw different generations: %v", gens)
		}
		if again := gen(t, d); again != gens[0] {
			t.Fatalf("generation changed without a wipe: %q → %q", gens[0], again)
		}
	})

	t.Run("concurrent assignment has one owner and bumps the epoch once", func(t *testing.T) {
		d := newDirectory(t)
		g := gen(t, d)
		var wg sync.WaitGroup
		results := make([]Assignment, 10)
		created := make([]bool, 10)
		errs := make([]error, 10)
		for i := range results {
			wg.Go(func() { results[i], created[i], errs[i] = d.Assign(ctx, "room", fmt.Sprintf("node-%d", i), g, ttl) })
		}
		wg.Wait()
		winners := 0
		for i, a := range results {
			if errs[i] != nil {
				t.Fatal(errs[i])
			}
			if created[i] {
				winners++
			}
			if a != results[0] {
				t.Fatalf("callers saw different owners: %+v vs %+v", a, results[0])
			}
		}
		if winners != 1 || results[0].Epoch != 1 || results[0].Gen != g || results[0].Token == "" {
			t.Fatalf("winners=%d owner=%+v", winners, results[0])
		}
		if owner, ok, err := d.Owner(ctx, "room"); err != nil || !ok || owner != results[0] {
			t.Fatalf("owner = %+v %v %v", owner, ok, err)
		}
		// epoch が 1 回だけ増えたことを、次の割り当てが 2 になることで確かめる
		if ok, err := d.Release(ctx, "room", results[0].Token); err != nil || !ok {
			t.Fatalf("release: %v %v", ok, err)
		}
		if next, _ := assign(t, d, "room", "node-x"); next.Epoch != 2 {
			t.Fatalf("epoch after one handover = %d", next.Epoch)
		}
	})

	t.Run("another node sees the current owner", func(t *testing.T) {
		d := newDirectory(t)
		first, created := assign(t, d, "room", "a")
		if !created || first.Node != "a" {
			t.Fatalf("first = %+v created=%v", first, created)
		}
		second, created := assign(t, d, "room", "b")
		if created || second != first {
			t.Fatalf("second = %+v created=%v", second, created)
		}
		other, created := assign(t, d, "other", "b")
		if !created || other.Epoch != 1 || other.Node != "b" {
			t.Fatalf("rooms are independent: %+v", other)
		}
	})

	t.Run("renew extends only with the current token", func(t *testing.T) {
		d := newDirectory(t)
		a, _ := assign(t, d, "room", "a")
		if ok, err := d.Renew(ctx, "room", "not-the-token", 10*ttl); err != nil || ok {
			t.Fatalf("renew with a wrong token: %v %v", ok, err)
		}
		if ok, err := d.Renew(ctx, "room", a.Token, 3*ttl); err != nil || !ok {
			t.Fatalf("renew: %v %v", ok, err)
		}
		d.advance(2 * ttl)
		if owner, ok, _ := d.Owner(ctx, "room"); !ok || owner != a {
			t.Fatalf("renewed lease expired at the original ttl: %+v %v", owner, ok)
		}
	})

	t.Run("after expiry the next owner gets a new epoch and the old token is dead", func(t *testing.T) {
		d := newDirectory(t)
		old, _ := assign(t, d, "room", "a")
		d.advance(ttl + 50*time.Millisecond)
		if _, ok, _ := d.Owner(ctx, "room"); ok {
			t.Fatal("lease survived its ttl")
		}
		next, created := assign(t, d, "room", "b")
		if !created || next.Node != "b" || next.Epoch != old.Epoch+1 || next.Token == old.Token {
			t.Fatalf("next = %+v (old %+v)", next, old)
		}
		if ok, _ := d.Renew(ctx, "room", old.Token, ttl); ok {
			t.Fatal("old token renewed the new owner's lease")
		}
		if ok, _ := d.Release(ctx, "room", old.Token); ok {
			t.Fatal("old token released the new owner's lease")
		}
		if owner, ok, _ := d.Owner(ctx, "room"); !ok || owner != next {
			t.Fatalf("new owner lost the lease: %+v", owner)
		}
	})

	t.Run("a stale generation cannot assign and a wipe changes the generation", func(t *testing.T) {
		d := newDirectory(t)
		before := gen(t, d)
		a, _ := assign(t, d, "room", "a")
		if _, _, err := d.Assign(ctx, "other", "a", "not-the-gen", ttl); !errors.Is(err, ErrGenChanged) {
			t.Fatalf("assign with a wrong gen: %v", err)
		}
		d.wipe()
		if _, _, err := d.Assign(ctx, "room", "a", before, ttl); !errors.Is(err, ErrGenChanged) {
			t.Fatalf("assign with the gen from before the wipe: %v", err)
		}
		after := gen(t, d)
		if after == before {
			t.Fatal("generation survived a wipe")
		}
		if ok, _ := d.Renew(ctx, "room", a.Token, ttl); ok {
			t.Fatal("a lease from before the wipe was renewed")
		}
		next, created := assign(t, d, "room", "b")
		if !created || next.Gen != after {
			t.Fatalf("next = %+v", next)
		}
	})

	t.Run("heartbeat expires", func(t *testing.T) {
		d := newDirectory(t)
		info := NodeInfo{Addr: "10.0.0.1:3002", StartedAt: 1, State: NodeReady, Rooms: 2, Connections: 3, Capacity: 50}
		if err := d.Heartbeat(ctx, "node-a", info, ttl); err != nil {
			t.Fatal(err)
		}
		if got, ok, err := d.Node(ctx, "node-a"); err != nil || !ok || got != info {
			t.Fatalf("node = %+v %v %v", got, ok, err)
		}
		if _, ok, _ := d.Node(ctx, "node-b"); ok {
			t.Fatal("unknown node is alive")
		}
		d.advance(ttl + 50*time.Millisecond)
		if _, ok, _ := d.Node(ctx, "node-a"); ok {
			t.Fatal("node outlived its heartbeat")
		}
	})

	t.Run("presence expires but the room list keeps the room until forgotten", func(t *testing.T) {
		d := newDirectory(t)
		if err := d.PublishPresence(ctx, []RoomPresence{{Room: "a", Members: []string{"alice"}}, {Room: "b", EmptySince: 42}}, ttl); err != nil {
			t.Fatal(err)
		}
		if p, ok, err := d.Presence(ctx, "a"); err != nil || !ok || !slices.Equal(p.Members, []string{"alice"}) || p.EmptySince != 0 {
			t.Fatalf("presence a = %+v %v %v", p, ok, err)
		}
		if p, ok, _ := d.Presence(ctx, "b"); !ok || len(p.Members) != 0 || p.EmptySince != 42 {
			t.Fatalf("presence b = %+v", p)
		}
		if err := d.Forget(ctx, "a"); err != nil {
			t.Fatal(err)
		}
		if _, ok, _ := d.Presence(ctx, "a"); ok {
			t.Fatal("forgotten presence remains")
		}
		d.advance(ttl + 50*time.Millisecond)
		if _, ok, _ := d.Presence(ctx, "b"); ok {
			t.Fatal("presence outlived its ttl")
		}
		rooms, err := d.Rooms(ctx)
		if err != nil || !slices.Equal(rooms, []string{"b"}) {
			t.Fatalf("rooms = %v %v", rooms, err)
		}
	})

	t.Run("a retired room is not assigned to any node until the retirement expires", func(t *testing.T) {
		d := newDirectory(t)
		a, _ := assign(t, d, "room", "node-a")
		// 閉じる側は割り当てを解放する前に Retire する。どちらの順でも、解放したあとに別のノードが取れない
		if ok, err := d.Retire(ctx, "room", a.Token, 2*ttl); err != nil || !ok {
			t.Fatal(err)
		}
		if _, err := d.Release(ctx, "room", a.Token); err != nil {
			t.Fatal(err)
		}
		for _, node := range []string{"node-a", "node-b"} {
			if _, _, err := d.Assign(ctx, "room", node, gen(t, d), ttl); !errors.Is(err, ErrRetired) {
				t.Fatalf("assign a retired room to %s: %v", node, err)
			}
		}
		// ほかの部屋には効かない
		if _, created := assign(t, d, "other", "node-b"); !created {
			t.Fatal("retiring one room blocked another")
		}
		d.advance(2*ttl + 50*time.Millisecond)
		next, created := assign(t, d, "room", "node-b")
		if !created || next.Epoch != a.Epoch+1 {
			t.Fatalf("after retirement: %+v created=%v", next, created)
		}
		if _, err := d.Retire(ctx, "epoch:x", "", ttl); !errors.Is(err, ErrInvalidRoom) {
			t.Fatalf("retire an invalid room: %v", err)
		}
	})

	t.Run("retirement cannot close a new owner and cleans only its own presence", func(t *testing.T) {
		d := newDirectory(t)
		first, _ := assign(t, d, "room", "node-a")
		if ok, err := d.Retire(ctx, "room", "", ttl); err != nil || ok {
			t.Fatalf("absent retirement with owner: %v %v", ok, err)
		}
		if _, err := d.Release(ctx, "room", first.Token); err != nil {
			t.Fatal(err)
		}
		next, _ := assign(t, d, "room", "node-b")
		if err := d.PublishPresence(ctx, []RoomPresence{{Room: "room", Members: []string{"alice"}}}, ttl); err != nil {
			t.Fatal(err)
		}
		if ok, err := d.Retire(ctx, "room", first.Token, ttl); err != nil || ok {
			t.Fatalf("stale retirement: %v %v", ok, err)
		}
		if _, ok, _ := d.Presence(ctx, "room"); !ok {
			t.Fatal("stale retirement erased new presence")
		}
		if ok, err := d.Retire(ctx, "room", next.Token, ttl); err != nil || !ok {
			t.Fatalf("current retirement: %v %v", ok, err)
		}
		if _, held, _ := d.Owner(ctx, "room"); held {
			t.Fatal("retired owner remains")
		}
		if _, present, _ := d.Presence(ctx, "room"); present {
			t.Fatal("retired presence remains")
		}
		if rooms, _ := d.Rooms(ctx); slices.Contains(rooms, "room") {
			t.Fatal("retired room remains listed")
		}
	})

	t.Run("invalid arguments are rejected", func(t *testing.T) {
		d := newDirectory(t)
		g := gen(t, d)
		for _, room := range []string{"", "epoch:x"} {
			if _, _, err := d.Assign(ctx, room, "a", g, ttl); !errors.Is(err, ErrInvalidRoom) {
				t.Fatalf("assign %q: %v", room, err)
			}
			if _, err := d.Renew(ctx, room, "t", ttl); !errors.Is(err, ErrInvalidRoom) {
				t.Fatalf("renew %q: %v", room, err)
			}
			if _, err := d.Release(ctx, room, "t"); !errors.Is(err, ErrInvalidRoom) {
				t.Fatalf("release %q: %v", room, err)
			}
		}
		if _, _, err := d.Assign(ctx, "room", "a", g, time.Microsecond); !errors.Is(err, ErrInvalidLease) {
			t.Fatalf("assign with a tiny ttl: %v", err)
		}
		if _, _, err := d.Assign(ctx, "room", "", g, ttl); !errors.Is(err, ErrInvalidLease) {
			t.Fatalf("assign without a node: %v", err)
		}
	})
}

// backend は ubi:nodes の一覧から ubi:node:<id> を読んで置き場所を選ぶ（packages/backend の instancePlacement）。
func TestRedisHeartbeatListsTheNodeForPlacement(t *testing.T) {
	client := testRedis(t)
	ctx := context.Background()
	prefix := "ubi:test:nodes:" + newToken() + ":"
	t.Cleanup(func() {
		keys, _ := client.Keys(ctx, prefix+"*").Result()
		if len(keys) > 0 {
			_ = client.Del(ctx, keys...).Err()
		}
	})
	d := NewRedisDirectory(client, prefix)
	info := NodeInfo{Addr: "10.0.0.1:3002", StartedAt: 1, State: NodeDraining, Rooms: 2, Connections: 3, Capacity: 50}
	if err := d.Heartbeat(ctx, "node-a", info, time.Second); err != nil {
		t.Fatal(err)
	}
	if members, err := client.SMembers(ctx, prefix+"nodes").Result(); err != nil || !slices.Equal(members, []string{"node-a"}) {
		t.Fatalf("nodes = %v %v", members, err)
	}
	raw, err := client.Get(ctx, prefix+"node:node-a").Result()
	if err != nil {
		t.Fatal(err)
	}
	want := `{"addr":"10.0.0.1:3002","startedAt":1,"state":"draining","rooms":2,"connections":3,"capacity":50}`
	if raw != want {
		t.Fatalf("node value = %s", raw)
	}
	if ok, err := d.Retire(ctx, "room", "", time.Second); err != nil || !ok {
		t.Fatal(err)
	}
	if ttl, err := client.PTTL(ctx, prefix+"retired:room").Result(); err != nil || ttl <= 0 || ttl > time.Second {
		t.Fatalf("retired ttl = %v %v", ttl, err)
	}
}

func TestDirectoryForDoesNotFallBackToMemoryWhenRedisIsDown(t *testing.T) {
	client := redis.NewClient(&redis.Options{Addr: "127.0.0.1:1", MaxRetries: -1, DialTimeout: 200 * time.Millisecond})
	defer client.Close()
	d := DirectoryFor(client, nil)
	if _, isMemory := d.(*MemoryDirectory); isMemory {
		t.Fatal("Redis を設定したのにメモリの Directory になった")
	}
	ctx := context.Background()
	if _, err := d.ClusterGen(ctx); err == nil {
		t.Fatal("Redis が落ちているのに世代を返した")
	}
	if a, created, err := d.Assign(ctx, "room", "node", "gen", time.Second); err == nil || created {
		t.Fatalf("Redis が落ちているのに割り当てた: %+v %v", a, err)
	}
	if ok, err := d.Renew(ctx, "room", "token", time.Second); err == nil || ok {
		t.Fatalf("Redis が落ちているのに延長できた: %v %v", ok, err)
	}
}

func TestDirectoryForUsesMemoryWithoutRedis(t *testing.T) {
	if _, isMemory := DirectoryFor(nil, nil).(*MemoryDirectory); !isMemory {
		t.Fatal("Redis なしならメモリの Directory のはず")
	}
}

func TestNodeIDIsUniquePerStart(t *testing.T) {
	a, b := NewNodeID("instance-7f9c"), NewNodeID("instance-7f9c")
	if a == b || len(a) <= len("instance-7f9c-") {
		t.Fatalf("node IDs must differ per start: %q %q", a, b)
	}
	if NewNodeID("") == "" {
		t.Fatal("empty pod name must fall back to the hostname")
	}
}

// epoch はチケットの最長の期限（24 時間）より長く残し、それを過ぎてから数え直す。
func TestEpochOutlivesTheLongestTicket(t *testing.T) {
	clock := &testClock{now: time.Unix(1_700_000_000, 0)}
	m := NewMemoryDirectory(clock.Now)
	ctx := context.Background()
	gen, _ := m.ClusterGen(ctx)
	first, _, _ := m.Assign(ctx, "room", "a", gen, time.Second)
	_, _ = m.Release(ctx, "room", first.Token)
	clock.Advance(24 * time.Hour)
	if a, _, _ := m.Assign(ctx, "room", "a", gen, time.Second); a.Epoch != 2 {
		t.Fatalf("epoch restarted while a guest ticket could still be valid: %d", a.Epoch)
	}
	clock.Advance(epochRetention + time.Second)
	if a, _, _ := m.Assign(ctx, "room", "a", gen, time.Second); a.Epoch != 1 {
		t.Fatalf("epoch was kept forever: %d", a.Epoch)
	}
}

func TestRedisEpochKeyExpiresAfterRetention(t *testing.T) {
	client := testRedis(t)
	ctx := context.Background()
	prefix := "ubi:test:dir:" + newToken() + ":"
	t.Cleanup(func() {
		keys, _ := client.Keys(ctx, prefix+"*").Result()
		if len(keys) > 0 {
			_ = client.Del(ctx, keys...).Err()
		}
	})
	d := NewRedisDirectory(client, prefix)
	gen, _ := d.ClusterGen(ctx)
	if _, _, err := d.Assign(ctx, "room", "a", gen, time.Second); err != nil {
		t.Fatal(err)
	}
	ttl, err := client.PTTL(ctx, prefix+"room:epoch:room").Result()
	if err != nil || ttl < 24*time.Hour || ttl > epochRetention {
		t.Fatalf("epoch key ttl = %v %v", ttl, err)
	}
}
