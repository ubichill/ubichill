package coord

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"testing"
)

func TestRedisLoggerWritesThroughSlog(t *testing.T) {
	var buf bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&buf, nil))

	redisLogger{func() *slog.Logger { return logger }}.Printf(context.Background(), "redis: failed to close connection: %v", "use of closed network connection")

	var v map[string]any
	if err := json.Unmarshal(buf.Bytes(), &v); err != nil {
		t.Fatalf("not one JSON line: %q", buf.String())
	}
	if v["level"] != "WARN" || v["component"] != "redis" || v["msg"] != "failed to close connection: use of closed network connection" {
		t.Errorf("got %v", v)
	}
}
