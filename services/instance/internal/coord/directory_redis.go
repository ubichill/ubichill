package coord

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strconv"
	"time"

	"github.com/redis/go-redis/v9"
)

// 部屋の割り当ては R1 のリースの値（token を 1 項目に持つハッシュ）に node・epoch・gen を足した形。
// 照合は token の項目だけを見るので、R1 の RedisLease の延長・解放とも互換のまま。
var (
	clusterGenScript = redis.NewScript(`
local g = redis.call('GET', KEYS[1])
if g then return g end
redis.call('SET', KEYS[1], ARGV[1])
return ARGV[1]`)
	// KEYS: room, epoch, gen, retired / ARGV: node, gen, token, ttl, epochRetention
	assignScript = redis.NewScript(`
if redis.call('GET', KEYS[3]) ~= ARGV[2] then return {-1} end
if redis.call('EXISTS', KEYS[4]) == 1 then return {-2} end
local cur = redis.call('HMGET', KEYS[1], 'node', 'epoch', 'token', 'gen')
if cur[3] then return {0, cur[1], cur[2], cur[3], cur[4]} end
local epoch = redis.call('INCR', KEYS[2])
redis.call('PEXPIRE', KEYS[2], ARGV[5])
redis.call('HSET', KEYS[1], 'node', ARGV[1], 'epoch', epoch, 'token', ARGV[3], 'gen', ARGV[2])
redis.call('PEXPIRE', KEYS[1], ARGV[4])
return {1, ARGV[1], tostring(epoch), ARGV[3], ARGV[2]}`)
	// KEYS: room, epoch, gen / ARGV: fromToken, toNode, toToken, gen, ttl, epochRetention
	// epoch のキーが消えていても（保持期間の切れ）今の epoch より小さくしない。
	transferScript = redis.NewScript(`
if redis.call('GET', KEYS[3]) ~= ARGV[4] then return {-1} end
local cur = redis.call('HMGET', KEYS[1], 'epoch', 'token', 'gen')
if not cur[2] or cur[2] ~= ARGV[1] or cur[3] ~= ARGV[4] then return {0} end
local epoch = redis.call('INCR', KEYS[2])
local floor = tonumber(cur[1]) + 1
if epoch < floor then
  epoch = floor
  redis.call('SET', KEYS[2], epoch)
end
redis.call('PEXPIRE', KEYS[2], ARGV[6])
redis.call('HSET', KEYS[1], 'node', ARGV[2], 'epoch', epoch, 'token', ARGV[3], 'gen', ARGV[4])
redis.call('PEXPIRE', KEYS[1], ARGV[5])
return {1, ARGV[2], tostring(epoch), ARGV[3], ARGV[4]}`)
	// KEYS: room, epoch / ARGV: token, ttl, epochRetention
	roomRenewScript = redis.NewScript(`
if redis.call('HGET', KEYS[1], 'token') ~= ARGV[1] then return 0 end
redis.call('PEXPIRE', KEYS[2], ARGV[3])
return redis.call('PEXPIRE', KEYS[1], ARGV[2])`)
)

// RedisDirectory は Pod の間で共有する Directory。キーは設計書（docs/design/instance-scaling.md）の「Redis Directory」。
type RedisDirectory struct {
	client redis.UniversalClient
	prefix string
}

// NewRedisDirectory の prefix はキーの名前空間（本番は "ubi:"、テストは衝突しない値）。
func NewRedisDirectory(client redis.UniversalClient, prefix string) *RedisDirectory {
	return &RedisDirectory{client: client, prefix: prefix}
}

func (r *RedisDirectory) genKey() string                { return r.prefix + "cluster:gen" }
func (r *RedisDirectory) nodeKey(node string) string    { return r.prefix + "node:" + node }
func (r *RedisDirectory) roomKey(room string) string    { return r.prefix + "room:" + room }
func (r *RedisDirectory) epochKey(room string) string   { return r.prefix + "room:epoch:" + room }
func (r *RedisDirectory) presenceKey(id string) string  { return r.prefix + "presence:" + id }
func (r *RedisDirectory) roomsKey() string              { return r.prefix + "rooms" }
func (r *RedisDirectory) nodesKey() string              { return r.prefix + "nodes" }
func (r *RedisDirectory) retiredKey(room string) string { return r.prefix + "retired:" + room }

func (r *RedisDirectory) ClusterGen(ctx context.Context) (string, error) {
	return clusterGenScript.Run(ctx, r.client, []string{r.genKey()}, newToken()).Text()
}

func (r *RedisDirectory) Heartbeat(ctx context.Context, node string, info NodeInfo, ttl time.Duration) error {
	if err := validate(node, ttl); err != nil {
		return err
	}
	body, err := json.Marshal(info)
	if err != nil {
		return err
	}
	// ubi:nodes は backend が置き場所を選ぶときの一覧（KEYS・SCAN で全キーを舐めさせない）。
	// 期限の切れたノードは、読んだ backend が一覧から外す。
	_, err = r.client.Pipelined(ctx, func(pipe redis.Pipeliner) error {
		pipe.Set(ctx, r.nodeKey(node), body, ttl)
		pipe.SAdd(ctx, r.nodesKey(), node)
		return nil
	})
	return err
}

func (r *RedisDirectory) Node(ctx context.Context, node string) (NodeInfo, bool, error) {
	var info NodeInfo
	ok, err := r.getJSON(ctx, r.nodeKey(node), &info)
	return info, ok, err
}

func (r *RedisDirectory) getJSON(ctx context.Context, key string, v any) (bool, error) {
	body, err := r.client.Get(ctx, key).Bytes()
	if errors.Is(err, redis.Nil) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return true, json.Unmarshal(body, v)
}

func (r *RedisDirectory) Assign(ctx context.Context, room, node, gen string, ttl time.Duration) (Assignment, bool, error) {
	if err := validateRoom(room, ttl, true); err != nil {
		return Assignment{}, false, err
	}
	if node == "" {
		return Assignment{}, false, ErrInvalidLease
	}
	keys := []string{r.roomKey(room), r.epochKey(room), r.genKey(), r.retiredKey(room)}
	out, err := assignScript.Run(ctx, r.client, keys, node, gen, newToken(), ttl.Milliseconds(), epochRetention.Milliseconds()).Slice()
	if err != nil {
		return Assignment{}, false, err
	}
	status, _ := out[0].(int64)
	switch status {
	case -1:
		return Assignment{}, false, ErrGenChanged
	case -2:
		return Assignment{}, false, ErrRetired
	}
	a, err := assignmentOf(out[1:])
	return a, status == 1, err
}

func assignmentOf(fields []any) (Assignment, error) {
	if len(fields) != 4 {
		return Assignment{}, fmt.Errorf("directory: unexpected assignment %v", fields)
	}
	s := func(v any) string { str, _ := v.(string); return str }
	epoch, err := strconv.ParseInt(s(fields[1]), 10, 64)
	if err != nil {
		return Assignment{}, fmt.Errorf("directory: epoch: %w", err)
	}
	return Assignment{Node: s(fields[0]), Epoch: epoch, Token: s(fields[2]), Gen: s(fields[3])}, nil
}

func (r *RedisDirectory) Owner(ctx context.Context, room string) (Assignment, bool, error) {
	if err := validateRoom(room, 0, false); err != nil {
		return Assignment{}, false, err
	}
	out, err := r.client.HMGet(ctx, r.roomKey(room), "node", "epoch", "token", "gen").Result()
	if err != nil {
		return Assignment{}, false, err
	}
	if out[2] == nil {
		return Assignment{}, false, nil
	}
	a, err := assignmentOf(out)
	return a, err == nil, err
}

// Renew は延長を 1 つのパイプラインで送る。部屋ごとに往復を待つと、部屋の数だけ遅れが積み重なり、
// CPU が詰まった Pod では後ろの部屋が期限に間に合わず自己停止する。
func (r *RedisDirectory) Renew(ctx context.Context, ttl time.Duration, leases ...RoomLease) []Renewal {
	out := make([]Renewal, len(leases))
	cmds := r.renewPipeline(ctx, ttl, leases, out, func(pipe redis.Pipeliner, keys []string, args ...any) *redis.Cmd {
		return roomRenewScript.EvalSha(ctx, pipe, keys, args...)
	})
	// Redis が再起動するとスクリプトのキャッシュが消える。そのときだけ本文ごと送り直す
	if slices.ContainsFunc(cmds, func(c *redis.Cmd) bool { return c != nil && redis.HasErrorPrefix(c.Err(), "NOSCRIPT") }) {
		cmds = r.renewPipeline(ctx, ttl, leases, out, func(pipe redis.Pipeliner, keys []string, args ...any) *redis.Cmd {
			return roomRenewScript.Eval(ctx, pipe, keys, args...)
		})
	}
	for i, c := range cmds {
		if c == nil {
			continue
		}
		n, err := c.Int()
		out[i] = Renewal{OK: err == nil && n == 1, Err: err}
	}
	return out
}

func (r *RedisDirectory) renewPipeline(
	ctx context.Context,
	ttl time.Duration,
	leases []RoomLease,
	out []Renewal,
	run func(pipe redis.Pipeliner, keys []string, args ...any) *redis.Cmd,
) []*redis.Cmd {
	cmds := make([]*redis.Cmd, len(leases))
	pipe := r.client.Pipeline()
	for i, l := range leases {
		if err := validateRoom(l.Room, ttl, true); err != nil {
			out[i].Err = err
			continue
		}
		cmds[i] = run(pipe, []string{r.roomKey(l.Room), r.epochKey(l.Room)}, l.Token, ttl.Milliseconds(), epochRetention.Milliseconds())
	}
	if pipe.Len() > 0 {
		_, _ = pipe.Exec(ctx)
	}
	return cmds
}

func (r *RedisDirectory) Release(ctx context.Context, room, token string) (bool, error) {
	if err := validateRoom(room, 0, false); err != nil {
		return false, err
	}
	n, err := releaseScript.Run(ctx, r.client, []string{r.roomKey(room)}, token).Int()
	return err == nil && n == 1, err
}

func (r *RedisDirectory) Transfer(ctx context.Context, room, fromToken, toNode, toToken, gen string, ttl time.Duration) (Assignment, bool, error) {
	if err := validateTransfer(room, fromToken, toNode, toToken, ttl); err != nil {
		return Assignment{}, false, err
	}
	keys := []string{r.roomKey(room), r.epochKey(room), r.genKey()}
	out, err := transferScript.Run(ctx, r.client, keys, fromToken, toNode, toToken, gen, ttl.Milliseconds(), epochRetention.Milliseconds()).Slice()
	if err != nil {
		return Assignment{}, false, err
	}
	switch status, _ := out[0].(int64); status {
	case -1:
		return Assignment{}, false, ErrGenChanged
	case 0:
		return Assignment{}, false, nil
	}
	a, err := assignmentOf(out[1:])
	return a, err == nil, err
}

// Nodes は ubi:nodes の一覧から生きているノードを読む（期限の切れたノードは backend が一覧から外す）。
func (r *RedisDirectory) Nodes(ctx context.Context) (map[string]NodeInfo, error) {
	ids, err := r.client.SMembers(ctx, r.nodesKey()).Result()
	if err != nil || len(ids) == 0 {
		return map[string]NodeInfo{}, err
	}
	keys := make([]string, len(ids))
	for i, id := range ids {
		keys[i] = r.nodeKey(id)
	}
	values, err := r.client.MGet(ctx, keys...).Result()
	if err != nil {
		return nil, err
	}
	out := make(map[string]NodeInfo, len(ids))
	for i, v := range values {
		body, ok := v.(string)
		if !ok {
			continue
		}
		var info NodeInfo
		if json.Unmarshal([]byte(body), &info) == nil {
			out[ids[i]] = info
		}
	}
	return out, nil
}

func (r *RedisDirectory) PublishPresence(ctx context.Context, rooms []RoomPresence, ttl time.Duration) error {
	for _, p := range rooms {
		if err := validateRoom(p.Room, ttl, true); err != nil {
			return err
		}
	}
	if len(rooms) == 0 {
		return nil
	}
	_, err := r.client.Pipelined(ctx, func(pipe redis.Pipeliner) error {
		for _, p := range rooms {
			if p.Members == nil {
				p.Members = []string{}
			}
			body, err := json.Marshal(p)
			if err != nil {
				return err
			}
			pipe.Set(ctx, r.presenceKey(p.Room), body, ttl)
			pipe.SAdd(ctx, r.roomsKey(), p.Room)
		}
		return nil
	})
	return err
}

func (r *RedisDirectory) Presence(ctx context.Context, room string) (RoomPresence, bool, error) {
	p := RoomPresence{Room: room}
	ok, err := r.getJSON(ctx, r.presenceKey(room), &p)
	return p, ok, err
}

func (r *RedisDirectory) Rooms(ctx context.Context) ([]string, error) {
	return r.client.SMembers(ctx, r.roomsKey()).Result()
}

func (r *RedisDirectory) Forget(ctx context.Context, room string) error {
	if err := validateRoom(room, 0, false); err != nil {
		return err
	}
	_, err := r.client.TxPipelined(ctx, func(pipe redis.Pipeliner) error {
		pipe.SRem(ctx, r.roomsKey(), room)
		pipe.Del(ctx, r.presenceKey(room))
		return nil
	})
	return err
}

var retireScript = redis.NewScript(`
local token = redis.call('HGET', KEYS[1], 'token')
if token then
  if token ~= ARGV[1] then return 0 end
elseif ARGV[1] ~= '' then
  return 0
end
redis.call('SET', KEYS[2], '1', 'PX', ARGV[2])
redis.call('DEL', KEYS[1], KEYS[3])
redis.call('SREM', KEYS[4], ARGV[3])
return 1`)

func (r *RedisDirectory) Retire(ctx context.Context, room, token string, ttl time.Duration) (bool, error) {
	if err := validateRoom(room, ttl, true); err != nil {
		return false, err
	}
	keys := []string{r.roomKey(room), r.retiredKey(room), r.presenceKey(room), r.roomsKey()}
	n, err := retireScript.Run(ctx, r.client, keys, token, ttl.Milliseconds(), room).Int()
	return err == nil && n == 1, err
}

// DirectoryFor は Redis を設定していれば Redis の Directory だけを返す。LeaseFor と同じく、
// Redis が落ちてもメモリに切り替えない（各 Pod がそれぞれ owner になる）。落ちている間の操作はエラーになる。
func DirectoryFor(client *redis.Client, now func() time.Time) Directory {
	if client == nil {
		return NewMemoryDirectory(now)
	}
	return NewRedisDirectory(client, "ubi:")
}
