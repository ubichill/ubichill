package runtime

import "errors"

// 接続数の上限（--max-connections。0 なら無制限）。数えるのは connections() と同じ単位（部屋の参加者の接続＋中継している接続）。
//
//   - 上限の 9 割から新しい部屋を受けない（作成・引っ越しを 503、heartbeat の full、指標の空きを 0）。
//     持っている部屋に残りの 1 割で人が入れるようにする。heartbeat は 5 秒ごとで古いので、作成の 503 でも断る。
//   - 上限に達したら新しい参加者の world:join（直接・中継の両方）を instance_unavailable で断る。クライアントはチケットを
//     取り直して入り直す。入室中の人は切らず、猶予中の人の戻り・引っ越しの繋ぎ直しは断らない（数えていた人が戻るだけ）。
//   - /ready は落とさない。落とすと Service から外れ、中継している接続も含めて draining と同じ扱いになる。
//
// 判定と入室は別のロックなので、同時に来た入室（特に中継）の分だけ上限を少し超えることがある。
var errConnectionLimit = errors.New("node is at its connection limit")

// rejectReasonConnectionLimit は ubichill_instance_rejected_joins_total の reason。
const rejectReasonConnectionLimit = "connection_limit"

// roomCutoff は新しい部屋を受けなくなる接続数（上限の 9 割。端数は切り上げ）。
func roomCutoff(limit int) int { return limit - limit/10 }

// admitsConnection は接続 n 本を持つ Pod が、新しい参加者の接続を受けるか。
func (s *Server) admitsConnection(n int) bool {
	return s.config.MaxConnections <= 0 || n < s.config.MaxConnections
}

// admitsRooms は接続 n 本を持つ Pod が、新しい部屋を受けるか（draining は別に見る）。
func (s *Server) admitsRooms(n int) bool {
	return s.config.MaxConnections <= 0 || n < roomCutoff(s.config.MaxConnections)
}

// connectionsFull は新しい参加者を断る状態か。上限が無ければ数えない（connections は部屋ごとにロックを取る）。
func (s *Server) connectionsFull() bool {
	return s.config.MaxConnections > 0 && !s.admitsConnection(s.connections())
}

// roomsFull は接続数のために新しい部屋を断る状態か。
func (s *Server) roomsFull() bool {
	return s.config.MaxConnections > 0 && !s.admitsRooms(s.connections())
}

func (s *Server) rejectJoin(p *peer, id string) {
	s.rejectedJoins.Add(1)
	p.reply(id, unavailable())
}
