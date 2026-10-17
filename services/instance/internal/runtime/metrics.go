package runtime

import (
	"fmt"
	"net/http"
	"strings"
)

// metric は Prometheus の text 形式（0.0.4）の gauge 1 つ。ラベルは付けない（部屋 ID・利用者を出さず、系列の数も増やさない）。
type metric struct {
	name, help string
	value      int
}

// metrics は KEDA の scale-out と監視に使う、この Pod の負荷。heartbeat（Directory）に書く値と同じ数え方。
func (s *Server) metrics() []metric {
	s.mu.RLock()
	rooms := len(s.rooms)
	s.mu.RUnlock()
	relays := s.relayCount()
	draining := 0
	// draining の Pod は新しい部屋を受けないので、空きは 0 として出す（合計しても受けられる数を多く見積もらない）
	available := max(s.config.MaxRooms-rooms, 0)
	if s.draining.Load() {
		draining, available = 1, 0
	}
	return []metric{
		{"ubichill_instance_active_rooms", "Rooms this pod owns.", rooms},
		{"ubichill_instance_room_capacity", "Rooms this pod holds at most (--max-rooms).", s.config.MaxRooms},
		{"ubichill_instance_room_capacity_available", "Rooms this pod can still accept (0 while draining).", available},
		{"ubichill_instance_websocket_connections", "WebSocket connections this pod serves: room members (including those relayed from other pods) and connections it relays to other pods.", s.connections()},
		{"ubichill_instance_relay_connections", "WebSocket connections this pod relays to the owner pod of their room.", relays},
		{"ubichill_instance_draining", "1 while this pod refuses new rooms (after SIGTERM).", draining},
	}
}

func (s *Server) serveMetrics(w http.ResponseWriter, _ *http.Request) {
	var b strings.Builder
	for _, m := range s.metrics() {
		fmt.Fprintf(&b, "# HELP %s %s\n# TYPE %s gauge\n%s %d\n", m.name, m.help, m.name, m.name, m.value)
	}
	w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write([]byte(b.String()))
}
