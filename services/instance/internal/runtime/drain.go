package runtime

import (
	"context"
	"log"
	"sort"
	"time"
)

// migrateRetry は引っ越しに失敗した部屋を次に試すまでの時間。
const migrateRetry = 30 * time.Second

// Drain は draining に入り、接続（部屋の参加者と中継）と進めている引っ越しが無くなるか ctx が終わるまで待つ。
// そのあと Close で残りを閉じる。
//
//   - 持っている部屋は、作ってから MigrateAfter 経つまで待ち、経っても参加者が居れば別の Pod へ引っ越す（クライアントは繋ぎ直さない）。
//     空になった部屋は待たない（backend の掃除が閉じるか、最後に Close が解放する）。
//   - 部屋が無くなっても、この Pod に直接繋いでいるクライアント（いまは中継しているだけ）が居る間は止まらない。
//   - ctx の期限の DisconnectNotice 前に、直接繋いでいるクライアントへ server:notice を送る。
func (s *Server) Drain(ctx context.Context) {
	s.beginDrain()
	if ctx.Err() != nil {
		return
	}
	deadline, limited := ctx.Deadline()
	noticed := false
	tick := time.NewTicker(200 * time.Millisecond)
	defer tick.Stop()
	for {
		if limited && !noticed && time.Until(deadline) <= s.config.DisconnectNotice {
			s.noticeDisconnect(deadline)
			noticed = true
		}
		s.scheduleMigration()
		if s.migrations.Load() == 0 && s.connections() == 0 {
			return
		}
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		}
	}
}

// scheduleMigration は引っ越しを 1 つずつ進める（同時に多く動かすと、先の Pod が一度に受ける中継の繋ぎ直しが増える）。
func (s *Server) scheduleMigration() {
	if !s.migrations.CompareAndSwap(0, 1) {
		return
	}
	r := s.nextMigration()
	if r == nil {
		s.migrations.Store(0)
		return
	}
	go func() {
		defer s.migrations.Store(0)
		ctx, cancel := context.WithTimeout(context.Background(), 3*s.handoffTimeout)
		defer cancel()
		if err := s.migrate(ctx, r); err != nil {
			log.Printf("could not move %s yet: %v", r.definition.ID, err)
			s.mu.Lock()
			s.retryAt[r] = s.now().Add(migrateRetry)
			s.mu.Unlock()
		}
	}()
}

// nextMigration は引っ越す部屋を選ぶ。作ってから MigrateAfter 経ち、参加者（切断の猶予中を含む）の居る部屋を古い順に。
func (s *Server) nextMigration() *Room {
	now := s.now()
	s.mu.Lock()
	rooms := make([]*Room, 0, len(s.rooms))
	for _, r := range s.rooms {
		if at, ok := s.retryAt[r]; ok && now.Before(at) {
			continue
		}
		rooms = append(rooms, r)
	}
	s.mu.Unlock()
	sort.Slice(rooms, func(i, j int) bool { return rooms[i].createdAt < rooms[j].createdAt })
	for _, r := range rooms {
		if r.dueForMigration(now, s.config.MigrateAfter) {
			return r
		}
	}
	return nil
}

func (r *Room) dueForMigration(now time.Time, after time.Duration) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	return !r.closed && !r.migrating && len(r.members) > 0 && now.UnixMilli()-r.createdAt >= after.Milliseconds()
}

// noticeDisconnect は直接繋いでいるクライアントに、切る時刻を知らせる（中継されてきた接続には送らない。中継元の Pod が知らせる）。
func (s *Server) noticeDisconnect(at time.Time) {
	f := Frame{Event: "server:notice", Data: encoded(Object{"kind": "disconnect", "at": at.UnixMilli()})}
	f.raw = encoded(f)
	clients := s.directClients()
	for _, p := range clients {
		p.send(f, false)
	}
	log.Printf("draining: told %d clients that they will be disconnected at %s", len(clients), at.Format(time.RFC3339))
}

// DeletionCost は Pod を消す順の重み（controller.kubernetes.io/pod-deletion-cost）。小さい Pod から消える。
// 直接繋いでいるクライアントと、自分が owner の部屋の参加者を数える（どちらも消すと動かす・繋ぎ直させる量）。
func (s *Server) DeletionCost() int {
	n := len(s.directClients())
	s.mu.RLock()
	rooms := make([]*Room, 0, len(s.rooms))
	for _, r := range s.rooms {
		rooms = append(rooms, r)
	}
	s.mu.RUnlock()
	for _, r := range rooms {
		r.mu.Lock()
		n += len(r.members)
		r.mu.Unlock()
	}
	return n
}
