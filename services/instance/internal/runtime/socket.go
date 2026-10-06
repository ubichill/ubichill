package runtime

import (
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

type peer struct {
	id     string
	conn   *websocket.Conn
	out    chan Frame
	done   chan struct{}
	once   sync.Once
	room   *Room
	userID string
}

func (p *peer) stop()          { p.once.Do(func() { close(p.done); _ = p.conn.Close() }) }
func (p *peer) stopAfterSend() { p.send(Frame{Event: "__close"}, false) }
func (p *peer) send(f Frame, volatile bool) {
	select {
	case <-p.done:
		return
	default:
	}
	select {
	case p.out <- f:
	default:
		if !volatile {
			p.stop()
		}
	}
}
func (p *peer) reply(id string, v any) {
	if id != "" {
		p.send(Frame{ReplyTo: id, Data: encoded(v)}, false)
	}
}
func (p *peer) reject(id, message string) {
	if id != "" {
		p.reply(id, failure(message))
	} else {
		p.send(Frame{Event: "error", Data: encoded(message)}, false)
	}
}
func (p *peer) write() {
	tick := time.NewTicker(20 * time.Second)
	defer tick.Stop()
	defer p.stop()
	for {
		select {
		case <-p.done:
			return
		case f := <-p.out:
			if f.Event == "__close" {
				return
			}
			_ = p.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if p.conn.WriteJSON(f) != nil {
				return
			}
		case <-tick.C:
			if p.conn.WriteControl(websocket.PingMessage, nil, time.Now().Add(5*time.Second)) != nil {
				return
			}
		}
	}
}
func (s *Server) serveSocket(w http.ResponseWriter, r *http.Request) {
	upgrader := websocket.Upgrader{CheckOrigin: s.originAllowed, HandshakeTimeout: 10 * time.Second}
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	p := &peer{id: newID(), conn: conn, out: make(chan Frame, 256), done: make(chan struct{})}
	go p.write()
	defer p.stop()
	defer func() {
		s.admission.Lock()
		defer s.admission.Unlock()
		if p.room != nil {
			p.room.leave(p, s.config.Grace)
		}
		if p.room == nil {
			if s.active[p.userID] == p {
				delete(s.active, p.userID)
			}
		} else {
			// Remember the disconnected session through the grace period so a
			// reconnect into another room can release the old room immediately.
			time.AfterFunc(s.config.Grace, func() {
				s.admission.Lock()
				defer s.admission.Unlock()
				if s.active[p.userID] == p {
					delete(s.active, p.userID)
				}
			})
		}
	}()
	conn.SetReadLimit(70 << 10)
	_ = conn.SetReadDeadline(time.Now().Add(10 * time.Second))
	conn.SetPongHandler(func(string) error {
		if p.room != nil {
			return conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		}
		return nil
	})
	window := time.Now()
	count := 0
	// Request IDs correlate replies. The client never automatically replays
	// mutations after reconnect; the room snapshot restores its state.
	for {
		var f Frame
		if conn.ReadJSON(&f) != nil {
			return
		}
		if time.Since(window) > time.Second {
			window = time.Now()
			count = 0
		}
		count++
		if count > 240 {
			p.reject(f.ID, "rate limit exceeded")
			continue
		}
		if len(f.ID) > 100 {
			return
		}
		if f.Event == "world:join" {
			if p.room != nil {
				p.reject(f.ID, "already joined")
				continue
			}
			data, ok := object(f.Data)
			user, _ := data["user"].(map[string]any)
			if !ok || f.ID == "" || !validUser(user) {
				p.reject(f.ID, "不正な入室情報です")
				continue
			}
			id := str(data["instanceId"])
			t, err := s.verify(str(data["token"]), id)
			room := s.room(id)
			if err != nil {
				p.reply(f.ID, Object{"success": false, "error": "参加チケットが無効です", "code": "ticket_invalid"})
				continue
			}
			if room == nil {
				p.reply(f.ID, Object{"success": false, "error": "インスタンスが見つかりません", "code": "instance_unavailable"})
				continue
			}
			s.admission.Lock()
			old := s.active[t.Subject]
			err = room.join(p, user, t.Subject, f.ID)
			if err == nil {
				// Keep the previous session if the destination rejects admission.
				if old != nil && old != p && old.room != nil && old.room != room {
					old.room.leave(old, 0)
					old.send(Frame{Event: "session:replaced"}, false)
					old.stopAfterSend()
				}
				s.active[t.Subject] = p
			}
			s.admission.Unlock()
			if err != nil {
				p.reject(f.ID, err.Error())
			} else {
				_ = conn.SetReadDeadline(time.Now().Add(60 * time.Second))
			}
		} else if p.room == nil {
			p.reject(f.ID, "最初にワールドに参加する必要があります")
		} else if f.Event == "world:leave" {
			s.admission.Lock()
			p.room.leave(p, 0)
			p.room = nil
			if s.active[p.userID] == p {
				delete(s.active, p.userID)
			}
			s.admission.Unlock()
			p.reply(f.ID, Object{"success": true})
			p.stopAfterSend()
			returnAfterSend(p)
			return
		} else {
			p.room.handle(p, f)
		}
	}
}
func returnAfterSend(p *peer) {
	select {
	case <-p.done:
	case <-time.After(2 * time.Second):
	}
}
