// Package coord は複数の Pod の間で共有する状態（リース。G1 以降で Directory・在席）を扱う。
// Redis が無い単体モード・テストではメモリ実装を使う。
package coord

import (
	"context"
	"fmt"
	"log/slog"
	"strings"

	"github.com/redis/go-redis/v9"
)

// NewRedisClient は REDIS_URL / REDIS_PASSWORD から Redis クライアントを作る。url が空なら nil を返す（Redis なしで動く）。
// 接続は最初のコマンドで張られるので、Redis が落ちていても起動は止めない。
func NewRedisClient(url, password string) (*redis.Client, error) {
	if url == "" {
		return nil, nil
	}
	opts, err := redis.ParseURL(url)
	if err != nil {
		return nil, fmt.Errorf("REDIS_URL: %w", err)
	}
	if password != "" {
		opts.Password = password
	}
	redis.SetLogger(redisLogger{slog.Default})
	return redis.NewClient(opts), nil
}

// redisLogger は go-redis の内部のログ（接続の失敗など）を slog の警告にする。go-redis は既定で自分の形式の行を
// stderr に直接書き、--log-format=json の行に JSON でない行が混ざる。
type redisLogger struct{ logger func() *slog.Logger }

func (l redisLogger) Printf(ctx context.Context, format string, v ...any) {
	l.logger().WarnContext(ctx, strings.TrimPrefix(fmt.Sprintf(format, v...), "redis: "), "component", "redis")
}
