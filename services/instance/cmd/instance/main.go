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
	allowedOrigins := strings.Split(*origins, ",")
	for i := range allowedOrigins {
		allowedOrigins[i] = strings.TrimSpace(allowedOrigins[i])
	}
	s := runtime.New(runtime.Config{AdminToken: token, Guests: *guests, Origins: allowedOrigins, Grace: *grace})
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
	log.Printf("instance runtime listening on %s (guests=%v)", *addr, *guests)
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}
