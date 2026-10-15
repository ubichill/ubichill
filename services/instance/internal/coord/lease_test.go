package coord

import (
	"context"
	"errors"
	"os"
	"sync"
	"testing"
	"time"
)

// testLease は契約テストを当てる実装と、期限を進める方法の組。
// メモリ実装は時計を進め、Redis 実装は実際に待つ。
type testLease struct {
	Lease
	advance func(time.Duration)
}

func TestMemoryLeaseContract(t *testing.T) {
	runLeaseContract(t, func(t *testing.T) testLease {
		m := NewMemoryLease()
		now := time.Unix(1_700_000_000, 0)
		var mu sync.Mutex
		m.now = func() time.Time { mu.Lock(); defer mu.Unlock(); return now }
		return testLease{m, func(d time.Duration) { mu.Lock(); now = now.Add(d); mu.Unlock() }}
	})
}

func TestMemoryLeaseExpiresExactlyAtTTL(t *testing.T) {
	m := NewMemoryLease()
	now := time.Unix(1_700_000_000, 0)
	m.now = func() time.Time { return now }
	ctx := context.Background()
	if _, ok, _ := m.Acquire(ctx, "x", time.Second); !ok {
		t.Fatal("first acquire failed")
	}
	now = now.Add(time.Second - time.Nanosecond)
	if _, ok, _ := m.Acquire(ctx, "x", time.Second); ok {
		t.Fatal("acquired before the lease expired")
	}
	now = now.Add(time.Nanosecond)
	if _, ok, _ := m.Acquire(ctx, "x", time.Second); !ok {
		t.Fatal("lease must be free once ttl has elapsed")
	}
}

// Redis 実装は REDIS_URL があるときだけ動かす（例: REDIS_URL=redis://127.0.0.1:6390 go test ./internal/coord/）。
func TestRedisLeaseContract(t *testing.T) {
	url := os.Getenv("REDIS_URL")
	if url == "" {
		t.Skip("REDIS_URL is not set")
	}
	client, err := NewRedisClient(url, os.Getenv("REDIS_PASSWORD"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = client.Close() })
	ctx := context.Background()
	if err := client.Ping(ctx).Err(); err != nil {
		t.Fatalf("redis ping: %v", err)
	}
	prefix := "ubi:test:lease:" + newToken() + ":"
	t.Cleanup(func() {
		keys, _ := client.Keys(ctx, prefix+"*").Result()
		if len(keys) > 0 {
			_ = client.Del(ctx, keys...).Err()
		}
	})
	runLeaseContract(t, func(t *testing.T) testLease {
		return testLease{NewRedisLease(client, prefix+t.Name()+":"), time.Sleep}
	})
}

const contractTTL = 200 * time.Millisecond

func runLeaseContract(t *testing.T, newLease func(t *testing.T) testLease) {
	ctx := context.Background()
	acquire := func(t *testing.T, l Lease, name string) string {
		t.Helper()
		token, ok, err := l.Acquire(ctx, name, contractTTL)
		if err != nil || !ok || token == "" {
			t.Fatalf("acquire %q: token=%q ok=%v err=%v", name, token, ok, err)
		}
		return token
	}
	held := func(t *testing.T, l Lease, name string) bool {
		t.Helper()
		token, ok, err := l.Acquire(ctx, name, contractTTL)
		if err != nil {
			t.Fatal(err)
		}
		if ok {
			_, _ = l.Release(ctx, name, token)
		}
		return !ok
	}

	t.Run("only one holder at a time", func(t *testing.T) {
		l := newLease(t)
		acquire(t, l, "a")
		if !held(t, l, "a") {
			t.Fatal("second acquire succeeded while held")
		}
		acquire(t, l, "b")
	})

	t.Run("concurrent acquires grant exactly one token", func(t *testing.T) {
		l := newLease(t)
		var wg sync.WaitGroup
		var mu sync.Mutex
		granted := 0
		for range 20 {
			wg.Add(1)
			go func() {
				defer wg.Done()
				if _, ok, err := l.Acquire(ctx, "race", contractTTL); err == nil && ok {
					mu.Lock()
					granted++
					mu.Unlock()
				}
			}()
		}
		wg.Wait()
		if granted != 1 {
			t.Fatalf("granted %d tokens", granted)
		}
	})

	t.Run("renew extends only with the current token", func(t *testing.T) {
		l := newLease(t)
		token := acquire(t, l, "a")
		if ok, err := l.Renew(ctx, "a", "not-the-token", 10*contractTTL); err != nil || ok {
			t.Fatalf("renew with a wrong token: ok=%v err=%v", ok, err)
		}
		if ok, err := l.Renew(ctx, "a", token, 3*contractTTL); err != nil || !ok {
			t.Fatalf("renew with the token: ok=%v err=%v", ok, err)
		}
		l.advance(2 * contractTTL)
		if !held(t, l, "a") {
			t.Fatal("renewed lease expired at the original ttl")
		}
	})

	t.Run("a wrong token neither extends nor releases", func(t *testing.T) {
		l := newLease(t)
		acquire(t, l, "a")
		if ok, err := l.Release(ctx, "a", "not-the-token"); err != nil || ok {
			t.Fatalf("release with a wrong token: ok=%v err=%v", ok, err)
		}
		if !held(t, l, "a") {
			t.Fatal("a wrong token released the lease")
		}
		_, _ = l.Renew(ctx, "a", "not-the-token", 10*contractTTL)
		l.advance(contractTTL + 50*time.Millisecond)
		if held(t, l, "a") {
			t.Fatal("a wrong token extended the lease")
		}
	})

	t.Run("release frees the name and the old token stays dead", func(t *testing.T) {
		l := newLease(t)
		old := acquire(t, l, "a")
		if ok, err := l.Release(ctx, "a", old); err != nil || !ok {
			t.Fatalf("release: ok=%v err=%v", ok, err)
		}
		if ok, _ := l.Release(ctx, "a", old); ok {
			t.Fatal("released twice")
		}
		next := acquire(t, l, "a")
		if next == old {
			t.Fatal("token was reused")
		}
		if ok, _ := l.Renew(ctx, "a", old, contractTTL); ok {
			t.Fatal("old token renewed the new holder's lease")
		}
		if ok, _ := l.Release(ctx, "a", old); ok {
			t.Fatal("old token released the new holder's lease")
		}
		if !held(t, l, "a") {
			t.Fatal("new holder lost the lease")
		}
	})

	t.Run("an expired holder cannot touch the next holder", func(t *testing.T) {
		l := newLease(t)
		old := acquire(t, l, "a")
		l.advance(contractTTL + 50*time.Millisecond)
		if ok, _ := l.Renew(ctx, "a", old, contractTTL); ok {
			t.Fatal("renewed after expiry")
		}
		acquire(t, l, "a")
		if ok, _ := l.Release(ctx, "a", old); ok {
			t.Fatal("expired token released the next holder")
		}
		if !held(t, l, "a") {
			t.Fatal("next holder lost the lease")
		}
	})

	t.Run("renew of an unknown name fails", func(t *testing.T) {
		l := newLease(t)
		if ok, err := l.Renew(ctx, "never", "token", contractTTL); err != nil || ok {
			t.Fatalf("ok=%v err=%v", ok, err)
		}
	})

	t.Run("invalid arguments are rejected", func(t *testing.T) {
		l := newLease(t)
		for _, ttl := range []time.Duration{0, -time.Second, time.Microsecond} {
			if _, _, err := l.Acquire(ctx, "a", ttl); !errors.Is(err, ErrInvalidLease) {
				t.Fatalf("acquire ttl=%v: err=%v", ttl, err)
			}
			if _, err := l.Renew(ctx, "a", "t", ttl); !errors.Is(err, ErrInvalidLease) {
				t.Fatalf("renew ttl=%v: err=%v", ttl, err)
			}
		}
		if _, _, err := l.Acquire(ctx, "", contractTTL); !errors.Is(err, ErrInvalidLease) {
			t.Fatalf("empty name: err=%v", err)
		}
		if _, err := l.Release(ctx, "", "t"); !errors.Is(err, ErrInvalidLease) {
			t.Fatalf("release empty name: err=%v", err)
		}
	})
}
