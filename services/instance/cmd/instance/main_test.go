package main

import (
	"testing"

	"github.com/redis/go-redis/v9"
)

func TestDirectoryClientFor(t *testing.T) {
	rdb := redis.NewClient(&redis.Options{Addr: "127.0.0.1:1"})
	defer rdb.Close()
	cases := []struct {
		mode    string
		rdb     *redis.Client
		want    *redis.Client
		wantErr bool
	}{
		{mode: "", rdb: rdb, want: nil},          // 既定はメモリ。Redis を設定していても割り当てには使わない
		{mode: "memory", rdb: rdb, want: nil},    // 明示のメモリ
		{mode: "redis", rdb: rdb, want: rdb},     // 複数 Pod
		{mode: "redis", rdb: nil, wantErr: true}, // Redis なしで redis は起動させない（黙ってメモリにしない）
		{mode: "Redis", rdb: rdb, wantErr: true}, // 綴りの誤りも起動させない
	}
	for _, c := range cases {
		got, err := directoryClientFor(c.mode, c.rdb)
		if (err != nil) != c.wantErr || got != c.want {
			t.Errorf("mode=%q: got (%v, %v)", c.mode, got, err)
		}
	}
}
