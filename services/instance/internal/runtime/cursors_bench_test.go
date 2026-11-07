package runtime

import (
	"fmt"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"syscall"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

// BenchmarkCursorFanout は 1 部屋で movers 人がカーソルを 1 回ずつ動かした 50ms 分（20Hz の 1 周期）を、
// 全員の WebSocket に届け切るまでを 1 op とする。受信は同じプロセスの生の read（バイト数を数えるだけ）。
//
//   - each: まとめない（今まで通り。送り手ごと・受け手ごとに 1 フレーム）
//   - batch: まとめ送り（受け手ごとに自分の分を除く。動かなかった受け手は同じバイト列を共有）
//   - shared: 比較用。自分の分も含めた全員分を 1 回だけ作り、全員に同じバイト列を送る（クライアントが自分の分を捨てる）
//
// 移動の受信（JSON の解釈）は handle を直接呼んで含める。-cpu 1 で ns/op が CPU 時間に近くなる。cpu-ns/op は getrusage の値。
func BenchmarkCursorFanout(b *testing.B) {
	for _, size := range []struct{ members, movers int }{{10, 1}, {10, 3}, {50, 3}, {50, 15}} {
		for _, mode := range []string{"each", "batch", "shared"} {
			b.Run(fmt.Sprintf("members=%d/movers=%d/%s", size.members, size.movers, mode), func(b *testing.B) {
				benchFanout(b, size.members, size.movers, mode)
			})
		}
	}
}

func benchFanout(b *testing.B, members, movers int, mode string) {
	interval := time.Duration(0)
	var features []string
	if mode != "each" {
		interval, features = time.Hour, batchFeatures
	}
	s := newServer(Config{AdminToken: strings.Repeat("a", 32), Grace: time.Second, CursorBatch: interval})
	r, err := s.Provision(roomFor("bench", members))
	if err != nil {
		b.Fatal(err)
	}
	h := httptest.NewServer(s.Handler())
	b.Cleanup(func() { s.Close(); h.Close() })

	var total atomic.Int64
	var target atomic.Int64
	target.Store(1 << 62)
	signal := make(chan struct{}, 1)
	for i := range members {
		c, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(h.URL, "http")+"/realtime/v1/ws", nil)
		if err != nil {
			b.Fatal(err)
		}
		b.Cleanup(func() { _ = c.Close() })
		data := Object{"instanceId": "bench", "token": s.sign(ticket{"bench", fmt.Sprintf("u%02d", i), time.Now().Add(time.Hour).Unix(), "member", "", ""}),
			"user": Object{"name": "u", "status": "online", "position": Object{"x": 0, "y": 0}}}
		if features != nil {
			data["features"] = features
		}
		if err := c.WriteJSON(Frame{Event: "world:join", ID: "join", Data: encoded(data)}); err != nil {
			b.Fatal(err)
		}
		for {
			var f Frame
			if err := c.ReadJSON(&f); err != nil {
				b.Fatal(err)
			}
			if f.Event == "world:snapshot" {
				break
			}
		}
		raw := c.UnderlyingConn()
		go func() {
			buf := make([]byte, 64<<10)
			for {
				n, err := raw.Read(buf)
				if err != nil {
					return
				}
				if total.Add(int64(n)) >= target.Load() {
					select {
					case signal <- struct{}{}:
					default:
					}
				}
			}
		}()
	}
	r.mu.Lock()
	senders := make([]*peer, 0, movers)
	for i := range movers {
		senders = append(senders, r.members[fmt.Sprintf("u%02d", i)].peer)
	}
	r.mu.Unlock()
	moves := make([]Frame, movers)
	for i := range moves {
		moves[i] = Frame{Event: "cursor:move", Data: encoded(Object{"position": Object{"x": 100 + i, "y": 200 + i}})}
	}
	round := func() {
		for i, p := range senders {
			r.handle(p, moves[i])
		}
		switch mode {
		case "batch":
			r.flushCursors()
		case "shared":
			flushShared(r)
		}
	}
	wait := func(want int64) {
		target.Store(want)
		for total.Load() < want {
			<-signal
		}
	}
	quiet := func() int64 {
		last := total.Load()
		for {
			time.Sleep(30 * time.Millisecond)
			if now := total.Load(); now == last {
				return now
			} else {
				last = now
			}
		}
	}
	base := quiet()
	round()
	perOp := quiet() - base
	base += perOp
	if perOp <= 0 {
		b.Fatal("nothing was delivered")
	}

	var before, after syscall.Rusage
	_ = syscall.Getrusage(syscall.RUSAGE_SELF, &before)
	b.ReportAllocs()
	b.ResetTimer()
	for i := range b.N {
		round()
		wait(base + int64(i+1)*perOp)
	}
	b.StopTimer()
	_ = syscall.Getrusage(syscall.RUSAGE_SELF, &after)
	cpu := time.Duration(after.Utime.Nano()+after.Stime.Nano()-before.Utime.Nano()-before.Stime.Nano()) * time.Nanosecond
	b.ReportMetric(float64(cpu.Nanoseconds())/float64(b.N), "cpu-ns/op")
	b.ReportMetric(float64(perOp), "wire-B/op")
	b.ReportMetric(float64(framesPerRound(members, movers, mode)), "frames/op")
}

func framesPerRound(members, movers int, mode string) int {
	switch mode {
	case "each":
		return movers * (members - 1)
	case "batch":
		if movers > 1 {
			return members
		}
		return members - movers
	default:
		return members
	}
}

// flushShared は比較用のまとめ方（自分の分を除かず、全員分を 1 回だけ作って全員に送る）。
func flushShared(r *Room) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.cursorTimer != nil {
		r.cursorTimer.Stop()
		r.cursorTimer = nil
	}
	pending := r.cursors
	r.cursors = nil
	if len(pending) == 0 {
		return
	}
	list := make([]Object, 0, len(pending))
	for _, out := range pending {
		list = append(list, out)
	}
	f := Frame{Event: "cursors:moved", Data: encoded(list)}
	f.raw = encoded(f)
	for _, m := range r.members {
		if m.peer != nil && m.peer.batchCursors {
			m.peer.send(f, true)
		}
	}
}
