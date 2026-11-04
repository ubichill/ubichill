package runtime

import (
	"slices"
	"strings"
	"time"
)

// カーソルのまとめ送り（--cursor-batch-interval。0 なら 1 件ずつ）。
// CPU の大半は WebSocket の送信（1 フレーム 1 write）なので、間隔の中の cursor:move を利用者ごとに最新の 1 件にし、
// 受け手ごとに 1 フレームの cursors:moved で送る。world:join で features に featureCursorBatch を宣言した接続だけが受ける。
// Go とフロントは別々にデプロイされるので、宣言しない接続（古いフロント・外部の実装）には今まで通り cursor:moved を送る。
const featureCursorBatch = "cursors:batch"

// knownFeatures は world:join の data.features から、このサーバーが知っている機能だけを返す（知らないものは読み飛ばす）。
func knownFeatures(v any) []string {
	list, _ := v.([]any)
	for _, f := range list {
		if f == featureCursorBatch {
			return []string{featureCursorBatch}
		}
	}
	return nil
}

func batchesCursors(features []string) bool { return slices.Contains(features, featureCursorBatch) }

// moveCursor は r.mu の下で呼ぶ。宣言しない受け手にはすぐ送り、宣言した受け手の分は次のまとめ送りまで持つ。
func (r *Room) moveCursor(from *peer, out Object) {
	if r.cursorBatch <= 0 {
		r.broadcast("cursor:moved", out, from, true)
		return
	}
	var single Frame
	batched := false
	for _, m := range r.members {
		p := m.peer
		if p == nil || p == from {
			continue
		}
		if p.batchCursors {
			batched = true
			continue
		}
		if single.raw == nil {
			single = Frame{Event: "cursor:moved", raw: encoded(Frame{Event: "cursor:moved", Data: encoded(out)})}
		}
		p.send(single, true)
	}
	if !batched {
		return
	}
	if r.cursors == nil {
		r.cursors = map[string]Object{}
	}
	r.cursors[from.userID] = out
	// 動きの無い部屋ではタイマーを持たない（最初の move で張り、送ったら外す）
	if r.cursorTimer == nil {
		r.cursorTimer = time.AfterFunc(r.cursorBatch, r.flushCursors)
	}
}

func (r *Room) flushCursors() {
	r.mu.Lock()
	defer r.mu.Unlock()
	// タイマーから呼ばれたときは止めても何も起きない。テスト・ベンチマークで直接呼んだときに残さない
	if r.cursorTimer != nil {
		r.cursorTimer.Stop()
		r.cursorTimer = nil
	}
	pending := r.cursors
	r.cursors = nil
	if r.closed || len(pending) == 0 {
		return
	}
	entries := make([]cursorEntry, 0, len(pending))
	for id, out := range pending {
		entries = append(entries, cursorEntry{id, encoded(out)})
	}
	slices.SortFunc(entries, func(a, b cursorEntry) int { return strings.Compare(a.user, b.user) })
	// 動かなかった受け手は全員分の同じバイト列を受ける。動いた受け手だけ自分の分を除いて組み直す（符号化はせず連結だけ）
	var everyone Frame
	for _, m := range r.members {
		p := m.peer
		if p == nil || !p.batchCursors {
			continue
		}
		if _, moved := pending[p.userID]; moved {
			if len(entries) > 1 {
				p.send(cursorsFrame(entries, p.userID), true)
			}
			continue
		}
		if everyone.raw == nil {
			everyone = cursorsFrame(entries, "")
		}
		p.send(everyone, true)
	}
}

// stopCursorsLocked は部屋を閉じる・手放すときに、まとめ送りのタイマーと持っている分を捨てる。
func (r *Room) stopCursorsLocked() {
	if r.cursorTimer != nil {
		r.cursorTimer.Stop()
		r.cursorTimer = nil
	}
	r.cursors = nil
}

type cursorEntry struct {
	user string
	raw  []byte
}

const cursorsPrefix = `{"event":"cursors:moved","data":[`

// cursorsFrame は skip の分を除いた cursors:moved のフレーム（Frame を encoded したものと同じバイト列）。
func cursorsFrame(entries []cursorEntry, skip string) Frame {
	size := len(cursorsPrefix) + 2
	for _, e := range entries {
		size += len(e.raw) + 1
	}
	b := make([]byte, 0, size)
	b = append(b, cursorsPrefix...)
	first := true
	for _, e := range entries {
		if e.user == skip {
			continue
		}
		if !first {
			b = append(b, ',')
		}
		b = append(b, e.raw...)
		first = false
	}
	b = append(b, "]}"...)
	return Frame{Event: "cursors:moved", raw: b}
}
