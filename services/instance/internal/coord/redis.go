// Package coord は複数の Pod の間で共有する状態（リース。G1 以降で Directory・在席）を扱う。
// Redis が無い単体モード・テストではメモリ実装を使う。
package coord

import (
	"fmt"

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
	return redis.NewClient(opts), nil
}
