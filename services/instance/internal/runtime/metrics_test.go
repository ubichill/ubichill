package runtime

import (
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"testing"
	"time"
)

var sampleLine = regexp.MustCompile(`^([a-zA-Z_:][a-zA-Z0-9_:]*) (-?[0-9]+)$`)

// scrape は /metrics を Authorization なしで読み、text 形式として解釈する。形式が崩れていたら失敗にする。
func scrape(t *testing.T, n *node) map[string]int {
	t.Helper()
	res, err := http.Get(n.http.URL + "/metrics")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(res.Body)
	if res.StatusCode != 200 {
		t.Fatalf("metrics: %d %s", res.StatusCode, body)
	}
	if got := res.Header.Get("Content-Type"); !strings.HasPrefix(got, "text/plain; version=0.0.4") {
		t.Fatalf("content type = %q", got)
	}
	values := map[string]int{}
	typed := map[string]bool{}
	for _, line := range strings.Split(strings.TrimSuffix(string(body), "\n"), "\n") {
		if name, ok := strings.CutPrefix(line, "# TYPE "); ok {
			if !strings.HasSuffix(name, " gauge") {
				t.Fatalf("type line %q", line)
			}
			typed[strings.TrimSuffix(name, " gauge")] = true
			continue
		}
		if strings.HasPrefix(line, "# HELP ") {
			continue
		}
		m := sampleLine.FindStringSubmatch(line)
		if m == nil {
			t.Fatalf("not a sample line: %q", line)
		}
		if _, dup := values[m[1]]; dup || !typed[m[1]] {
			t.Fatalf("sample %s is duplicated or has no TYPE", m[1])
		}
		values[m[1]], _ = strconv.Atoi(m[2])
	}
	return values
}

func expectMetrics(t *testing.T, label string, got map[string]int, want map[string]int) {
	t.Helper()
	for name, value := range want {
		if v, ok := got["ubichill_instance_"+name]; !ok || v != value {
			t.Fatalf("%s: %s = %d (present %v), want %d", label, name, v, ok, value)
		}
	}
}

func TestMetricsOfAnIdlePod(t *testing.T) {
	c := newCluster()
	a := c.pod(t, "node-a")
	got := scrape(t, a)
	expectMetrics(t, "idle", got, map[string]int{
		"active_rooms": 0, "room_capacity": 1000, "room_capacity_available": 1000,
		"websocket_connections": 0, "relay_connections": 0, "draining": 0,
	})
	if len(got) != 6 {
		t.Fatalf("unexpected series: %v", got)
	}
}

// 中継する Pod と owner の Pod の両方に接続が数えられる（どちらも WebSocket を持つ）。部屋 ID は出さない。
func TestMetricsCountRelayedConnectionsOnBothPods(t *testing.T) {
	c := newCluster()
	a := c.pod(t, "node-a")
	b := startPodWith(t, c.dir, "node-b", c.clock.Now, func(config *Config) { config.MaxRooms = 1 })
	provision(t, a, "secret-room-id")
	a.maintain()
	alice, out := joinWith(t, b.http, "secret-room-id", memberGrant(t, a, "secret-room-id", "alice"))
	joined(t, out)
	_, out = joinWith(t, a.http, "secret-room-id", memberGrant(t, a, "secret-room-id", "bob"))
	joined(t, out)
	expectMetrics(t, "owner", scrape(t, a), map[string]int{"active_rooms": 1, "room_capacity_available": 999, "websocket_connections": 2, "relay_connections": 0})
	expectMetrics(t, "relay", scrape(t, b), map[string]int{"active_rooms": 0, "room_capacity_available": 1, "websocket_connections": 1, "relay_connections": 1})

	res, err := http.Get(a.http.URL + "/metrics")
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(res.Body)
	_ = res.Body.Close()
	if strings.Contains(string(body), "secret-room-id") || strings.Contains(string(body), "alice") {
		t.Fatalf("metrics leak identifiers: %s", body)
	}

	// 上限に達した Pod の空きは 0（負にならない）
	provision(t, b, "one")
	expectMetrics(t, "full", scrape(t, b), map[string]int{"active_rooms": 1, "room_capacity": 1, "room_capacity_available": 0})

	// 切断した中継は数から外れる
	_ = alice.Close()
	deadline := time.Now().Add(3 * time.Second)
	for scrape(t, b)["ubichill_instance_relay_connections"] != 0 {
		if time.Now().After(deadline) {
			t.Fatal("relay connection was still counted after the client left")
		}
		time.Sleep(20 * time.Millisecond)
	}
	expectMetrics(t, "after leave", scrape(t, b), map[string]int{"websocket_connections": 0})
}

func TestMetricsWhileDraining(t *testing.T) {
	c := newCluster()
	a := c.pod(t, "node-a")
	provision(t, a, "room")
	a.beginDrain()
	expectMetrics(t, "draining", scrape(t, a), map[string]int{"active_rooms": 1, "room_capacity": 1000, "room_capacity_available": 0, "draining": 1})
}

func TestMetricsOnlyAnswersGet(t *testing.T) {
	c := newCluster()
	a := c.pod(t, "node-a")
	res, err := http.Post(a.http.URL+"/metrics", "text/plain", strings.NewReader(""))
	if err != nil {
		t.Fatal(err)
	}
	_ = res.Body.Close()
	if res.StatusCode != http.StatusMethodNotAllowed {
		t.Fatalf("POST /metrics: %d", res.StatusCode)
	}
}
