package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/ubichill/ubichill/services/instance/internal/coord"
	"github.com/ubichill/ubichill/services/instance/internal/kube"
	"github.com/ubichill/ubichill/services/instance/internal/logging"
	"github.com/ubichill/ubichill/services/instance/internal/runtime"
)

func main() {
	// 不正なフラグも slog で報告する（--log-format=json のとき stderr を JSON の行だけに保つ）。-h の使い方だけはそのまま書く
	flag.CommandLine.Init(os.Args[0], flag.ContinueOnError)
	flag.CommandLine.SetOutput(io.Discard)
	addr := flag.String("listen", "127.0.0.1:3002", "HTTP/WebSocket listen address")
	world := flag.String("world", "", "instance definition JSON (no SNS or database required)")
	guests := flag.Bool("guests", false, "allow server-issued guest identities")
	origins := flag.String("origins", os.Getenv("CORS_ORIGIN"), "comma-separated browser origins")
	grace := flag.Duration("disconnect-grace", 15*time.Second, "reconnect grace period")
	maxRooms := flag.Int("max-rooms", 1000, "rooms this node holds at most (advertised as its capacity)")
	drainTimeout := flag.Duration("drain-timeout", 0, "on SIGTERM, refuse new rooms and wait up to this long for connections to end before closing the rest")
	migrateAfter := flag.Duration("migrate-after", 3*time.Hour, "while draining, move rooms this old (with participants) to another node without reconnecting the clients")
	disconnectNotice := flag.Duration("disconnect-notice", 10*time.Minute, "while draining, send server:notice to direct clients this long before the drain timeout")
	cursorBatch := flag.Duration("cursor-batch-interval", 50*time.Millisecond, "send the latest cursor of each user once per interval to clients that declare cursors:batch (0 sends every move)")
	maxConnections := flag.Int("max-connections", 0, "WebSocket connections (room members and relays) this node accepts at most; new rooms stop at 90% (0 = unlimited)")
	deletionCost := flag.Bool("pod-deletion-cost", false, "write controller.kubernetes.io/pod-deletion-cost on this pod (needs a service account that can patch it)")
	logFormat := flag.String("log-format", envOr("INSTANCE_LOG_FORMAT", "auto"), "stderr log format: auto (colored text on a terminal, otherwise JSON), text or json (env INSTANCE_LOG_FORMAT)")
	logLevel := flag.String("log-level", envOr("INSTANCE_LOG_LEVEL", "info"), "minimum log level: debug, info, warn or error (env INSTANCE_LOG_LEVEL)")
	parseErr := flag.CommandLine.Parse(os.Args[1:])
	if errors.Is(parseErr, flag.ErrHelp) {
		flag.CommandLine.SetOutput(os.Stderr)
		flag.Usage()
		return
	}
	logger, err := logging.New(os.Stderr, *logFormat, *logLevel)
	slog.SetDefault(logger)
	if err != nil {
		fatal(2, "invalid log settings", "err", err)
	}
	if parseErr != nil {
		fatal(2, "invalid flags", "err", parseErr)
	}
	token := os.Getenv("INSTANCE_ADMIN_TOKEN")
	if !*guests && len(token) < 32 {
		fatal(1, "managed mode requires INSTANCE_ADMIN_TOKEN (at least 32 characters)")
	}
	ticketKey := os.Getenv("INSTANCE_TICKET_KEY")
	if ticketKey != "" && len(ticketKey) < 32 {
		fatal(1, "INSTANCE_TICKET_KEY must be at least 32 characters")
	}
	rdb, err := coord.NewRedisClient(os.Getenv("REDIS_URL"), os.Getenv("REDIS_PASSWORD"))
	if err != nil {
		fatal(1, "invalid redis settings", "err", err)
	}
	if rdb != nil {
		defer rdb.Close()
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			if err := rdb.Ping(ctx).Err(); err != nil {
				slog.Warn("redis is not reachable yet (rooms cannot be assigned until it is)", "err", err)
				return
			}
			slog.Info("redis connected")
		}()
	}
	allowedOrigins := strings.Split(*origins, ",")
	for i := range allowedOrigins {
		allowedOrigins[i] = strings.TrimSpace(allowedOrigins[i])
	}
	// 部屋の割り当てを Redis で共有するかは明示して決める（既定はメモリ）。1 Pod では共有する相手がおらず、
	// Redis の可用性が部屋の可用性の上限になるだけなので、複数 Pod にするときだけ redis にする。
	// redis にしたら、落ちてもメモリに切り替えない（coord.DirectoryFor）。
	directoryClient, err := directoryClientFor(os.Getenv("INSTANCE_DIRECTORY"), rdb)
	if err != nil {
		fatal(1, "invalid directory settings", "err", err)
	}
	node := coord.NewNodeID(os.Getenv("POD_NAME"))
	s := runtime.New(runtime.Config{
		AdminToken: token, TicketKey: ticketKey, Guests: *guests, Origins: allowedOrigins, Grace: *grace,
		Directory: coord.DirectoryFor(directoryClient, nil), Node: node, Addr: advertiseAddr(*addr), MaxRooms: *maxRooms,
		MigrateAfter: *migrateAfter, DisconnectNotice: *disconnectNotice, CursorBatch: *cursorBatch, MaxConnections: *maxConnections,
	})
	if *world != "" {
		if err := provisionWorld(s, *world); err != nil {
			fatal(1, "could not load the world", "path", *world, "err", err)
		}
	}
	server := &http.Server{
		Handler: s.Handler(), ReadHeaderTimeout: 5 * time.Second, IdleTimeout: 60 * time.Second,
		// net/http の内部の失敗（TLS・Accept・ハンドラーの panic）も同じ形式で書く
		ErrorLog: slog.NewLogLogger(slog.Default().Handler(), slog.LevelWarn),
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if *deletionCost {
		// 書けなくても動作は続ける（消す Pod の選び方が ReplicaSet の既定に戻るだけ）
		if patcher, err := kube.InCluster(os.Getenv("POD_NAMESPACE"), os.Getenv("POD_NAME")); err != nil {
			slog.Warn("pod-deletion-cost is disabled", "err", err)
		} else {
			go kube.Run(context.Background(), patcher, s.DeletionCost, time.Now)
		}
	}
	go func() {
		<-ctx.Done()
		// 新しい部屋を断って readiness を落とし、migrate-after を過ぎた部屋は別のノードへ引っ越し、
		// 直接繋いでいる接続が抜けるのを drain-timeout まで待つ。残りは Close で閉じ、クライアントは繋ぎ直す
		drain, cancel := context.WithTimeout(context.Background(), *drainTimeout)
		s.Drain(drain)
		cancel()
		s.Close()
		shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdown)
	}()
	// 待ち受けてから listening を書く（ポートが使われていれば、listening の前に失敗を書いて終わる）
	listener, err := net.Listen("tcp", *addr)
	if err != nil {
		fatal(1, "could not listen", "addr", *addr, "err", err)
	}
	slog.Info("instance runtime listening", "addr", listener.Addr().String(), "node", node, "guests", *guests,
		"redis", rdb != nil, "directory", directoryName(directoryClient))
	if err := server.Serve(listener); err != nil && err != http.ErrServerClosed {
		fatal(1, "server stopped", "err", err)
	}
}

// fatal は起動を続けられない理由を slog で書いて終える。
func fatal(code int, msg string, args ...any) {
	slog.Error(msg, args...)
	os.Exit(code)
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// provisionWorld は --world の定義（InstanceDefinition の JSON）で部屋を作る。
func provisionWorld(s *runtime.Server, path string) error {
	body, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	var d runtime.Definition
	if err := json.Unmarshal(body, &d); err != nil {
		return err
	}
	_, err = s.Provision(d)
	return err
}

// advertiseAddr は他の Pod から届く自分のアドレス。INSTANCE_ADVERTISE_ADDR、無ければ POD_IP（Downward API）か
// ホスト名に待ち受けのポートを付ける。
func advertiseAddr(listen string) string {
	if v := os.Getenv("INSTANCE_ADVERTISE_ADDR"); v != "" {
		return v
	}
	_, port, err := net.SplitHostPort(listen)
	if err != nil {
		port = "3002"
	}
	host := os.Getenv("POD_IP")
	if host == "" {
		host, _ = os.Hostname()
	}
	return net.JoinHostPort(host, port)
}

// directoryClientFor は INSTANCE_DIRECTORY（memory / redis、既定 memory）から、Directory に使う Redis クライアントを返す。
// memory なら nil（Redis を設定していても部屋の割り当てには使わない）。
func directoryClientFor(mode string, rdb *redis.Client) (*redis.Client, error) {
	switch mode {
	case "", "memory":
		return nil, nil
	case "redis":
		if rdb == nil {
			return nil, errors.New("INSTANCE_DIRECTORY=redis requires REDIS_URL")
		}
		return rdb, nil
	default:
		return nil, fmt.Errorf("INSTANCE_DIRECTORY must be memory or redis (got %q)", mode)
	}
}

func directoryName(client *redis.Client) string {
	if client == nil {
		return "memory"
	}
	return "redis"
}
