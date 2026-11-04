package runtime

import (
	"fmt"
	"net/http"
	"strings"
)

// metric は Prometheus の text 形式（0.0.4）の系列 1 つ。部屋 ID・利用者はラベルに出さない（系列の数も増やさない）。
type metric struct {
	name, help string
	value      int64
	// counter なら単調増加（無ければ gauge）。labels は `reason="..."` のような固定の値だけ。
	counter bool
	labels  string
}

// metrics は KEDA の scale-out と監視に使う、この Pod の負荷。heartbeat（Directory）に書く値と同じ数え方。
func (s *Server) metrics() []metric {
	s.mu.RLock()
	rooms := len(s.rooms)
	s.mu.RUnlock()
	relays := s.relayCount()
	connections := s.connections()
	draining := 0
	// draining の Pod・接続数で新しい部屋を断っている Pod は、空きを 0 として出す（合計しても受けられる数を多く見積もらない）。
	// 接続数で断っている Pod は draining にしない（KEDA は draining の Pod の接続を除くので、負荷が見えなくなる）
	available := max(s.config.MaxRooms-rooms, 0)
	if !s.admitsRooms(connections) {
		available = 0
	}
	if s.draining.Load() {
		draining, available = 1, 0
	}
	return []metric{
		{name: "ubichill_instance_active_rooms", help: "Rooms this pod owns.", value: int64(rooms)},
		{name: "ubichill_instance_room_capacity", help: "Rooms this pod holds at most (--max-rooms).", value: int64(s.config.MaxRooms)},
		{name: "ubichill_instance_room_capacity_available", help: "Rooms this pod can still accept (0 while draining or near the connection limit).", value: int64(available)},
		{name: "ubichill_instance_websocket_connections", help: "WebSocket connections this pod serves: room members (including those relayed from other pods) and connections it relays to other pods.", value: int64(connections)},
		{name: "ubichill_instance_connection_capacity", help: "WebSocket connections this pod accepts at most (--max-connections, 0 = unlimited).", value: int64(s.config.MaxConnections)},
		{name: "ubichill_instance_relay_connections", help: "WebSocket connections this pod relays to the owner pod of their room.", value: int64(relays)},
		{name: "ubichill_instance_draining", help: "1 while this pod refuses new rooms (after SIGTERM).", value: int64(draining)},
		{name: "ubichill_instance_rejected_joins_total", help: "world:join requests this pod refused because of a limit.", value: s.rejectedJoins.Load(), counter: true, labels: `reason="` + rejectReasonConnectionLimit + `"`},
	}
}

func (s *Server) serveMetrics(w http.ResponseWriter, _ *http.Request) {
	var b strings.Builder
	for _, m := range s.metrics() {
		kind, series := "gauge", m.name
		if m.counter {
			kind = "counter"
		}
		if m.labels != "" {
			series += "{" + m.labels + "}"
		}
		fmt.Fprintf(&b, "# HELP %s %s\n# TYPE %s %s\n%s %d\n", m.name, m.help, m.name, kind, series, m.value)
	}
	w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write([]byte(b.String()))
}
