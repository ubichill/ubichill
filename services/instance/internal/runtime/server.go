package runtime

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

type Config struct {
	AdminToken string
	Guests     bool
	Origins    []string
	Grace      time.Duration
}
type Server struct {
	retired   map[string]time.Time
	mu        sync.RWMutex
	rooms     map[string]*Room
	admission sync.Mutex
	active    map[string]*peer
	key       []byte
	config    Config
}

func New(config Config) *Server {
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		panic(err)
	}
	return &Server{retired: map[string]time.Time{}, rooms: map[string]*Room{}, active: map[string]*peer{}, key: key, config: config}
}
func (s *Server) Provision(d Definition) (*Room, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for id, until := range s.retired {
		if time.Now().After(until) {
			delete(s.retired, id)
		}
	}
	if _, retired := s.retired[d.ID]; retired {
		return nil, errors.New("instance has been closed")
	}
	// Idempotent creation never resets an existing room, including an empty world.
	if r := s.rooms[d.ID]; r != nil {
		return r, nil
	}
	if len(s.rooms) >= 1000 {
		return nil, errors.New("instance limit reached")
	}
	r, err := newRoom(d)
	if err != nil {
		return nil, err
	}
	s.rooms[d.ID] = r
	return r, nil
}
func (s *Server) room(id string) *Room { s.mu.RLock(); defer s.mu.RUnlock(); return s.rooms[id] }
func (s *Server) Close() {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, r := range s.rooms {
		r.close(false)
	}
	s.rooms = map[string]*Room{}
}
func (s *Server) originAllowed(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true
	}
	u, err := url.Parse(origin)
	if err == nil && u.Host == r.Host {
		return true
	}
	for _, allowed := range s.config.Origins {
		if origin == allowed {
			return true
		}
	}
	return false
}
func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}
func decode(w http.ResponseWriter, r *http.Request, v any) bool {
	d := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8<<20))
	d.DisallowUnknownFields()
	if d.Decode(v) != nil {
		writeJSON(w, 400, failure("invalid JSON"))
		return false
	}
	var extra any
	if d.Decode(&extra) != io.EOF {
		writeJSON(w, 400, failure("invalid JSON"))
		return false
	}
	return true
}
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) { writeJSON(w, 200, Object{"status": "ok"}) })
	mux.HandleFunc("GET /realtime/v1/ws", s.serveSocket)
	mux.HandleFunc("GET /realtime/v1/instances", func(w http.ResponseWriter, r *http.Request) {
		if !s.authorize(w, r) {
			return
		}
		s.mu.RLock()
		defer s.mu.RUnlock()
		list := []Presence{}
		for _, room := range s.rooms {
			list = append(list, room.presence())
		}
		writeJSON(w, 200, Object{"instances": list})
	})
	mux.HandleFunc("PUT /realtime/v1/instances/{id}", func(w http.ResponseWriter, r *http.Request) {
		if !s.authorize(w, r) {
			return
		}
		var d Definition
		if !decode(w, r, &d) {
			return
		}
		if d.ID != r.PathValue("id") {
			writeJSON(w, 400, failure("id mismatch"))
			return
		}
		room, err := s.Provision(d)
		if err != nil {
			writeJSON(w, 400, failure(err.Error()))
			return
		}
		writeJSON(w, 200, room.presence())
	})
	mux.HandleFunc("GET /realtime/v1/instances/{id}", func(w http.ResponseWriter, r *http.Request) {
		if !s.config.Guests && !s.authorize(w, r) {
			return
		}
		room := s.room(r.PathValue("id"))
		if room == nil {
			writeJSON(w, 404, failure("instance not found"))
			return
		}
		p := room.presence()
		if s.config.Guests {
			p.MemberIDs = []string{}
		}
		writeJSON(w, 200, p)
	})
	mux.HandleFunc("DELETE /realtime/v1/instances/{id}", func(w http.ResponseWriter, r *http.Request) {
		if !s.authorize(w, r) {
			return
		}
		s.mu.Lock()
		defer s.mu.Unlock()
		room := s.rooms[r.PathValue("id")]
		if room == nil {
			s.retired[r.PathValue("id")] = time.Now().Add(2 * time.Minute)
			w.WriteHeader(204)
			return
		}
		if raw := r.URL.Query().Get("emptyBefore"); raw != "" {
			before, err := strconv.ParseInt(raw, 10, 64)
			room.mu.Lock()
			if err != nil || len(room.members) > 0 || room.emptySince > before {
				room.mu.Unlock()
				writeJSON(w, 409, failure("instance is occupied or recently emptied"))
				return
			}
			room.closed = true
			room.mu.Unlock()
		}
		room.close(true)
		delete(s.rooms, r.PathValue("id"))
		s.retired[r.PathValue("id")] = time.Now().Add(2 * time.Minute)
		w.WriteHeader(204)
	})
	mux.HandleFunc("POST /realtime/v1/instances/{id}/tickets", func(w http.ResponseWriter, r *http.Request) {
		if !s.authorize(w, r) {
			return
		}
		var body struct {
			UserID string `json:"userId"`
		}
		if !decode(w, r, &body) {
			return
		}
		if body.UserID == "" || len(body.UserID) > 200 || s.room(r.PathValue("id")) == nil {
			writeJSON(w, 400, failure("invalid participant or instance"))
			return
		}
		s.grant(w, r, body.UserID, "member", time.Minute*2)
	})
	mux.HandleFunc("POST /realtime/v1/instances/{id}/guest", func(w http.ResponseWriter, r *http.Request) {
		if !s.config.Guests {
			writeJSON(w, 403, failure("guest mode disabled"))
			return
		}
		if s.room(r.PathValue("id")) == nil {
			writeJSON(w, 404, failure("instance not found"))
			return
		}
		var body struct {
			ResumeToken string `json:"resumeToken"`
		}
		if !decode(w, r, &body) {
			return
		}
		id := "guest:" + newID()
		if body.ResumeToken != "" {
			if t, err := s.verify(body.ResumeToken, r.PathValue("id")); err == nil && t.Kind == "guest" {
				id = t.Subject
			}
		}
		s.grant(w, r, id, "guest", 24*time.Hour)
	})
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !s.originAllowed(r) {
			writeJSON(w, 403, failure("origin not allowed"))
			return
		}
		if origin := r.Header.Get("Origin"); origin != "" {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(204)
			return
		}
		mux.ServeHTTP(w, r)
	})
}
func (s *Server) authorize(w http.ResponseWriter, r *http.Request) bool {
	token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	if !strings.HasPrefix(r.Header.Get("Authorization"), "Bearer ") || s.config.AdminToken == "" || subtle.ConstantTimeCompare([]byte(token), []byte(s.config.AdminToken)) != 1 {
		writeJSON(w, 401, failure("unauthorized"))
		return false
	}
	return true
}
func (s *Server) grant(w http.ResponseWriter, r *http.Request, id, kind string, ttl time.Duration) {
	t := ticket{r.PathValue("id"), id, time.Now().Add(ttl).Unix(), kind}
	writeJSON(w, 200, Object{"token": s.sign(t), "userId": id, "expiresAt": t.Expires * 1000, "url": "/realtime/v1/ws", "protocolVersion": 1})
}
