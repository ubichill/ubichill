package coord

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
)

// Lease は名前ごとに 1 人だけが持てる期限付きの権利。token を持つ者だけが延長・解放できる。
// 期限が切れたあとに古い token で延長・解放しても、次の持ち主の権利は奪えない。
type Lease interface {
	// Acquire は空いていれば取得して token を返す。持ち主がいれば ok=false。
	Acquire(ctx context.Context, name string, ttl time.Duration) (token string, ok bool, err error)
	// Renew は token が今の持ち主と一致するときだけ期限を ttl に延ばす。
	Renew(ctx context.Context, name, token string, ttl time.Duration) (bool, error)
	// Release は token が今の持ち主と一致するときだけ解放する。
	Release(ctx context.Context, name, token string) (bool, error)
}

// ErrInvalidLease は名前・期限の指定が不正なとき（どちらの実装でも同じ判定）。
var ErrInvalidLease = errors.New("lease: name must be non-empty and ttl at least 1ms")

func validate(name string, ttl time.Duration) error {
	if name == "" || ttl < time.Millisecond {
		return ErrInvalidLease
	}
	return nil
}

func newToken() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return base64.RawURLEncoding.EncodeToString(b)
}

// MemoryLease は 1 プロセスの中だけで有効なリース（単体モード・テスト用）。
type MemoryLease struct {
	mu   sync.Mutex
	now  func() time.Time
	held map[string]memoryHold
}

type memoryHold struct {
	token   string
	expires time.Time
}

func NewMemoryLease() *MemoryLease {
	return &MemoryLease{now: time.Now, held: map[string]memoryHold{}}
}

// current は期限内の持ち主を返す。期限切れはここで消す（Redis の期限切れと同じ見え方にする）。
func (m *MemoryLease) current(name string) (memoryHold, bool) {
	h, ok := m.held[name]
	if ok && !m.now().Before(h.expires) {
		delete(m.held, name)
		return memoryHold{}, false
	}
	return h, ok
}

func (m *MemoryLease) Acquire(_ context.Context, name string, ttl time.Duration) (string, bool, error) {
	if err := validate(name, ttl); err != nil {
		return "", false, err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.current(name); ok {
		return "", false, nil
	}
	token := newToken()
	m.held[name] = memoryHold{token: token, expires: m.now().Add(ttl)}
	return token, true, nil
}

func (m *MemoryLease) Renew(_ context.Context, name, token string, ttl time.Duration) (bool, error) {
	if err := validate(name, ttl); err != nil {
		return false, err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	h, ok := m.current(name)
	if !ok || h.token != token {
		return false, nil
	}
	m.held[name] = memoryHold{token: token, expires: m.now().Add(ttl)}
	return true, nil
}

func (m *MemoryLease) Release(_ context.Context, name, token string) (bool, error) {
	if name == "" {
		return false, ErrInvalidLease
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	h, ok := m.current(name)
	if !ok || h.token != token {
		return false, nil
	}
	delete(m.held, name)
	return true, nil
}

// リースの値は token を 1 つの項目に持つハッシュ。G1 で部屋の owner（node・epoch）を同じキーに足しても、
// 延長・解放の照合は token の項目だけを見るので変えずに済む。
var (
	acquireScript = redis.NewScript(`
if redis.call('EXISTS', KEYS[1]) == 1 then return 0 end
redis.call('HSET', KEYS[1], 'token', ARGV[1])
redis.call('PEXPIRE', KEYS[1], ARGV[2])
return 1`)
	renewScript = redis.NewScript(`
if redis.call('HGET', KEYS[1], 'token') ~= ARGV[1] then return 0 end
return redis.call('PEXPIRE', KEYS[1], ARGV[2])`)
	releaseScript = redis.NewScript(`
if redis.call('HGET', KEYS[1], 'token') ~= ARGV[1] then return 0 end
return redis.call('DEL', KEYS[1])`)
)

// RedisLease は Pod の間で共有するリース。照合と更新を Lua で 1 回の操作にする
// （GET してから PEXPIRE する間に期限が切れて別の持ち主に移ると、その持ち主の期限を延ばしてしまう）。
type RedisLease struct {
	client redis.Scripter
	prefix string
}

// NewRedisLease の prefix はキーの名前空間（例: "ubi:lease:"、G1 の部屋の owner は "ubi:room:"）。
func NewRedisLease(client redis.Scripter, prefix string) *RedisLease {
	return &RedisLease{client: client, prefix: prefix}
}

func (r *RedisLease) Acquire(ctx context.Context, name string, ttl time.Duration) (string, bool, error) {
	if err := validate(name, ttl); err != nil {
		return "", false, err
	}
	token := newToken()
	n, err := acquireScript.Run(ctx, r.client, []string{r.prefix + name}, token, ttl.Milliseconds()).Int()
	if err != nil || n != 1 {
		return "", false, err
	}
	return token, true, nil
}

func (r *RedisLease) Renew(ctx context.Context, name, token string, ttl time.Duration) (bool, error) {
	if err := validate(name, ttl); err != nil {
		return false, err
	}
	n, err := renewScript.Run(ctx, r.client, []string{r.prefix + name}, token, ttl.Milliseconds()).Int()
	return err == nil && n == 1, err
}

func (r *RedisLease) Release(ctx context.Context, name, token string) (bool, error) {
	if name == "" {
		return false, ErrInvalidLease
	}
	n, err := releaseScript.Run(ctx, r.client, []string{r.prefix + name}, token).Int()
	return err == nil && n == 1, err
}

// LeaseFor は Redis を設定していれば Redis のリースだけを返す。Redis が落ちてもメモリのリースへ切り替えない
// （切り替えると各 Pod がそれぞれ持ち主になり、同じ部屋の owner が複数になる）。落ちている間の操作はエラーを返す。
// *redis.Client で受けるのは、nil の判定を確実にするため（インタフェースで受けると型付きの nil を見逃す）。
func LeaseFor(client *redis.Client, prefix string) Lease {
	if client == nil {
		return NewMemoryLease()
	}
	return NewRedisLease(client, prefix)
}
