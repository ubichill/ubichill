// Package logging は instance が stderr に書くログ（log/slog のハンドラー）を組み立てる。
// 端末には tint で色付きの 1 行、それ以外（Kubernetes・ubichill dev の子プロセス）には 1 行 1 つの JSON を書く。
// JSON は slog の既定のキー（time・level・msg）と属性だけで、ubichill dev はこの形を読む。
package logging

import (
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"strings"

	"github.com/lmittmann/tint"
	"golang.org/x/term"
)

// Format は --log-format の値。
type Format string

const (
	FormatAuto Format = "auto"
	FormatText Format = "text"
	FormatJSON Format = "json"
)

// ParseFormat は auto / text / json を読む（大文字小文字は問わない。空は auto）。
func ParseFormat(s string) (Format, error) {
	switch f := Format(strings.ToLower(strings.TrimSpace(s))); f {
	case "", FormatAuto:
		return FormatAuto, nil
	case FormatText, FormatJSON:
		return f, nil
	default:
		return FormatAuto, fmt.Errorf("log format must be auto, text or json (got %q)", s)
	}
}

// ParseLevel は debug / info / warn / error を読む（大文字小文字は問わない。空は info）。
func ParseLevel(s string) (slog.Level, error) {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "", "info":
		return slog.LevelInfo, nil
	case "debug":
		return slog.LevelDebug, nil
	case "warn", "warning":
		return slog.LevelWarn, nil
	case "error":
		return slog.LevelError, nil
	default:
		return slog.LevelInfo, fmt.Errorf("log level must be debug, info, warn or error (got %q)", s)
	}
}

// Resolve は auto を、書き先が端末なら text、そうでなければ json に決める。
func (f Format) Resolve(tty bool) Format {
	if f != FormatAuto {
		return f
	}
	if tty {
		return FormatText
	}
	return FormatJSON
}

// ColorEnabled は text に色を付けるか。NO_COLOR（https://no-color.org）が最優先で、FORCE_COLOR は端末でなくても付ける
// （pnpm dev の concurrently は出力をパイプで受けるが、自分の端末が色を出せるなら FORCE_COLOR を渡す）。
func ColorEnabled(capable bool, getenv func(string) string) bool {
	if getenv("NO_COLOR") != "" {
		return false
	}
	if v := getenv("FORCE_COLOR"); v != "" {
		return v != "0" && v != "false"
	}
	return capable
}

// NewHandler は format（auto は tty で決める）と level のハンドラーを作る。color は text のときだけ見る。
func NewHandler(w io.Writer, format Format, level slog.Leveler, tty, color bool) slog.Handler {
	if format.Resolve(tty) == FormatJSON {
		return slog.NewJSONHandler(w, &slog.HandlerOptions{Level: level})
	}
	return tint.NewTextHandler(w, &tint.Options{
		Level:       level,
		TimeFormat:  "15:04:05.000",
		NoColor:     !color,
		ReplaceAttr: redErrors,
	})
}

func redErrors(_ []string, a slog.Attr) slog.Attr {
	if a.Value.Kind() == slog.KindAny {
		if _, ok := a.Value.Any().(error); ok {
			return tint.Attr(9, a)
		}
	}
	return a
}

// New は f（stderr）に書くロガーを作る。format・level が読めなければ、読めた分と既定（auto・info）で作ったうえで
// エラーも返す（呼び出し側はそのロガーで報告して終える。--log-format=json のとき stderr を JSON だけに保つ）。
func New(f *os.File, format, level string) (*slog.Logger, error) {
	parsedFormat, formatErr := ParseFormat(format)
	parsedLevel, levelErr := ParseLevel(level)
	tty := term.IsTerminal(int(f.Fd()))
	color := ColorEnabled(tty && enableANSI(f), os.Getenv)
	return slog.New(NewHandler(f, parsedFormat, parsedLevel, tty, color)), errors.Join(formatErr, levelErr)
}
