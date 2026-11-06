package logging

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"os"
	"strings"
	"testing"
	"time"
)

func TestParseFormat(t *testing.T) {
	for _, c := range []struct {
		in   string
		want Format
		ok   bool
	}{
		{"", FormatAuto, true},
		{"auto", FormatAuto, true},
		{" JSON ", FormatJSON, true},
		{"Text", FormatText, true},
		{"jsonl", FormatAuto, false},
		{"pretty", FormatAuto, false},
	} {
		got, err := ParseFormat(c.in)
		if got != c.want || (err == nil) != c.ok {
			t.Errorf("ParseFormat(%q) = %q, %v; want %q, ok=%v", c.in, got, err, c.want, c.ok)
		}
	}
}

func TestParseLevel(t *testing.T) {
	for _, c := range []struct {
		in   string
		want slog.Level
		ok   bool
	}{
		{"", slog.LevelInfo, true},
		{"debug", slog.LevelDebug, true},
		{"INFO", slog.LevelInfo, true},
		{"warning", slog.LevelWarn, true},
		{" Warn", slog.LevelWarn, true},
		{"error", slog.LevelError, true},
		{"trace", slog.LevelInfo, false},
		{"-4", slog.LevelInfo, false},
	} {
		got, err := ParseLevel(c.in)
		if got != c.want || (err == nil) != c.ok {
			t.Errorf("ParseLevel(%q) = %v, %v; want %v, ok=%v", c.in, got, err, c.want, c.ok)
		}
	}
}

func TestResolve(t *testing.T) {
	for _, c := range []struct {
		format Format
		tty    bool
		want   Format
	}{
		{FormatAuto, true, FormatText},
		{FormatAuto, false, FormatJSON},
		// 明示したら端末かどうかで変えない
		{FormatJSON, true, FormatJSON},
		{FormatText, false, FormatText},
	} {
		if got := c.format.Resolve(c.tty); got != c.want {
			t.Errorf("%q.Resolve(%v) = %q, want %q", c.format, c.tty, got, c.want)
		}
	}
}

func TestColorEnabled(t *testing.T) {
	for _, c := range []struct {
		name    string
		capable bool
		env     map[string]string
		want    bool
	}{
		{"terminal", true, nil, true},
		{"pipe", false, nil, false},
		{"NO_COLOR on a terminal", true, map[string]string{"NO_COLOR": "1"}, false},
		{"NO_COLOR beats FORCE_COLOR", false, map[string]string{"NO_COLOR": "1", "FORCE_COLOR": "1"}, false},
		{"FORCE_COLOR through a pipe", false, map[string]string{"FORCE_COLOR": "3"}, true},
		{"FORCE_COLOR=0 on a terminal", true, map[string]string{"FORCE_COLOR": "0"}, false},
		{"FORCE_COLOR=false", true, map[string]string{"FORCE_COLOR": "false"}, false},
	} {
		got := ColorEnabled(c.capable, func(k string) string { return c.env[k] })
		if got != c.want {
			t.Errorf("%s: ColorEnabled = %v, want %v", c.name, got, c.want)
		}
	}
}

// ubichill dev との約束: --log-format=json なら 1 行に 1 つの JSON で、time・level・msg と属性を持つ。
func TestJSONContract(t *testing.T) {
	var buf bytes.Buffer
	logger := slog.New(NewHandler(&buf, FormatJSON, slog.LevelDebug, true, true))
	logger.Debug("room opened", "room", "r1", "epoch", int64(3))
	logger.Info("instance runtime listening", "addr", "127.0.0.1:3002", "guests", true)
	logger.Warn("redis is not reachable yet", "err", errors.New("dial tcp: \"refused\"\nretrying"))
	logger.Error("could not load the world", "path", "w.json")

	lines := scanLines(t, &buf)
	if len(lines) != 4 {
		t.Fatalf("got %d lines, want 4:\n%s", len(lines), buf.String())
	}
	wantLevels := []string{"DEBUG", "INFO", "WARN", "ERROR"}
	for i, line := range lines {
		var v map[string]any
		if err := json.Unmarshal([]byte(line), &v); err != nil {
			t.Fatalf("line %d is not JSON: %v\n%s", i, err, line)
		}
		if v["level"] != wantLevels[i] {
			t.Errorf("line %d level = %v, want %s", i, v["level"], wantLevels[i])
		}
		if _, err := time.Parse(time.RFC3339Nano, v["time"].(string)); err != nil {
			t.Errorf("line %d time = %v: %v", i, v["time"], err)
		}
		if msg, _ := v["msg"].(string); msg == "" {
			t.Errorf("line %d has no msg", i)
		}
	}
	var warn map[string]any
	_ = json.Unmarshal([]byte(lines[2]), &warn)
	// エラーは Error() の文字列（改行を含んでも 1 行に収まる）
	if warn["err"] != "dial tcp: \"refused\"\nretrying" {
		t.Errorf("err = %#v", warn["err"])
	}
	var info map[string]any
	_ = json.Unmarshal([]byte(lines[1]), &info)
	if info["guests"] != true || info["addr"] != "127.0.0.1:3002" {
		t.Errorf("attrs = %v", info)
	}
}

func TestLevelFilters(t *testing.T) {
	for _, format := range []Format{FormatJSON, FormatText} {
		var buf bytes.Buffer
		logger := slog.New(NewHandler(&buf, format, slog.LevelWarn, false, false))
		logger.Debug("d")
		logger.Info("i")
		logger.Warn("w")
		logger.Error("e")
		if got := len(scanLines(t, &buf)); got != 2 {
			t.Errorf("%s: %d lines at warn, want 2:\n%s", format, got, buf.String())
		}
	}
}

func TestAutoFollowsTerminal(t *testing.T) {
	var tty, pipe bytes.Buffer
	slog.New(NewHandler(&tty, FormatAuto, slog.LevelInfo, true, false)).Info("hello", "n", 1)
	slog.New(NewHandler(&pipe, FormatAuto, slog.LevelInfo, false, false)).Info("hello", "n", 1)
	if json.Valid(bytes.TrimSpace(tty.Bytes())) {
		t.Errorf("terminal got JSON: %s", tty.String())
	}
	if !json.Valid(bytes.TrimSpace(pipe.Bytes())) {
		t.Errorf("pipe did not get JSON: %s", pipe.String())
	}
}

func TestTextColor(t *testing.T) {
	var plain, colored bytes.Buffer
	err := errors.New("boom")
	slog.New(NewHandler(&plain, FormatText, slog.LevelInfo, false, false)).Warn("relay failed", "room", "r1", "err", err)
	slog.New(NewHandler(&colored, FormatText, slog.LevelInfo, true, true)).Warn("relay failed", "room", "r1", "err", err)

	if strings.Contains(plain.String(), "\x1b[") {
		t.Errorf("uncolored text has escapes: %q", plain.String())
	}
	for _, want := range []string{"WRN", "relay failed", "room=r1", "err=boom"} {
		if !strings.Contains(plain.String(), want) {
			t.Errorf("text %q lacks %q", plain.String(), want)
		}
	}
	// エラーの属性は赤（ANSI の 9。明るい赤）
	if !strings.Contains(colored.String(), "\x1b[2;91merr=") {
		t.Errorf("error attr is not red: %q", colored.String())
	}
}

// 読めない値でも、読めた分と既定でロガーを作ってから誤りを返す（呼び出し側がそのロガーで報告できる）。
func TestNewFallsBackAndReports(t *testing.T) {
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = r.Close() })

	logger, newErr := New(w, "pretty", "warn")
	logger.Info("hidden")
	logger.Error("invalid log settings", "err", newErr)
	_ = w.Close()
	out, _ := io.ReadAll(r)

	if newErr == nil || !strings.Contains(newErr.Error(), "pretty") {
		t.Fatalf("New error = %v", newErr)
	}
	lines := strings.Split(strings.TrimSpace(string(out)), "\n")
	// パイプは端末でないので auto は JSON。level=warn は読めているので info は出ない
	if len(lines) != 1 || !json.Valid([]byte(lines[0])) {
		t.Fatalf("got %q", out)
	}
}

func scanLines(t *testing.T, buf *bytes.Buffer) []string {
	t.Helper()
	var lines []string
	s := bufio.NewScanner(bytes.NewReader(buf.Bytes()))
	for s.Scan() {
		lines = append(lines, s.Text())
	}
	return lines
}
