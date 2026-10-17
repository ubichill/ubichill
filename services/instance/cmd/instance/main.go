package main

import (
	"context"
	"encoding/json"
	"flag"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/ubichill/ubichill/services/instance/internal/coord"
	"github.com/ubichill/ubichill/services/instance/internal/runtime"
)

func main() {
	addr := flag.String("listen", "127.0.0.1:3002", "HTTP/WebSocket listen address")
	world := flag.String("world", "", "instance definition JSON (no SNS or database required)")
	guests := flag.Bool("guests", false, "allow server-issued guest identities")
	origins := flag.String("origins", os.Getenv("CORS_ORIGIN"), "comma-separated browser origins")
	grace := flag.Duration("disconnect-grace", 15*time.Second, "reconnect grace period")
	flag.Parse()
	token := os.Getenv("INSTANCE_ADMIN_TOKEN")
	if !*guests && len(token) < 32 {
		log.Fatal("managed mode requires INSTANCE_ADMIN_TOKEN (at least 32 characters)")
	}
	ticketKey := os.Getenv("INSTANCE_TICKET_KEY")
	if ticketKey != "" && len(ticketKey) < 32 {
		log.Fatal("INSTANCE_TICKET_KEY must be at least 32 characters")
	}
	rdb, err := coord.NewRedisClient(os.Getenv("REDIS_URL"), os.Getenv("REDIS_PASSWORD"))
	if err != nil {
		log.Fatal(err)
	}
	if rdb != nil {
		defer rdb.Close()
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			if err := rdb.Ping(ctx).Err(); err != nil {
				log.Printf("redis is not reachable yet (continuing without it): %v", err)
				return
			}
			log.Printf("redis connected")
		}()
	}
	allowedOrigins := strings.Split(*origins, ",")
	for i := range allowedOrigins {
		allowedOrigins[i] = strings.TrimSpace(allowedOrigins[i])
	}
	s := runtime.New(runtime.Config{AdminToken: token, TicketKey: ticketKey, Guests: *guests, Origins: allowedOrigins, Grace: *grace})
	if *world != "" {
		body, err := os.ReadFile(*world)
		if err != nil {
			log.Fatal(err)
		}
		var d runtime.Definition
		if err = json.Unmarshal(body, &d); err != nil {
			log.Fatal(err)
		}
		if _, err = s.Provision(d); err != nil {
			log.Fatal(err)
		}
	}
	server := &http.Server{Addr: *addr, Handler: s.Handler(), ReadHeaderTimeout: 5 * time.Second, IdleTimeout: 60 * time.Second}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go func() {
		<-ctx.Done()
		s.Close()
		shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdown)
	}()
	log.Printf("instance runtime listening on %s (guests=%v, redis=%v)", *addr, *guests, rdb != nil)
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}
