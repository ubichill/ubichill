package runtime

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

const homeOrigin = "https://home.test"
const visitorOrigin = "https://visitor.example"

func startFederated(t *testing.T, federated bool) (*Server, *httptest.Server) {
	t.Helper()
	s := New(Config{AdminToken: strings.Repeat("a", 32), Origins: []string{homeOrigin}, FederatedVisits: federated, Grace: 20 * time.Millisecond})
	if _, err := s.Provision(definition("a")); err != nil {
		t.Fatal(err)
	}
	h := httptest.NewServer(s.Handler())
	t.Cleanup(func() { s.Close(); h.Close() })
	return s, h
}

func dialFrom(t *testing.T, h *httptest.Server, origin string) (*websocket.Conn, *http.Response, error) {
	t.Helper()
	header := http.Header{}
	if origin != "" {
		header.Set("Origin", origin)
	}
	c, res, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(h.URL, "http")+"/realtime/v1/ws", header)
	if c != nil {
		t.Cleanup(func() { _ = c.Close() })
	}
	return c, res, err
}

func joinFederated(t *testing.T, c *websocket.Conn, token string) Object {
	t.Helper()
	data := Object{"instanceId": "a", "token": token, "user": Object{"name": "user", "status": "online", "position": Object{"x": 0, "y": 0}}}
	if err := c.WriteJSON(Frame{Event: "world:join", ID: "join", Data: encoded(data)}); err != nil {
		t.Fatal(err)
	}
	out, _ := object(receive(t, c, "join").Data)
	return out
}

func visitTicket(user, origin string) ticket {
	return ticket{"a", user, time.Now().Add(time.Minute).Unix(), "member", "", origin}
}

func TestFederatedVisitorJoinsOnlyWithTicketBoundToItsOrigin(t *testing.T) {
	s, h := startFederated(t, true)

	c, _, err := dialFrom(t, h, visitorOrigin)
	if err != nil {
		t.Fatalf("visitor origin rejected at upgrade: %v", err)
	}
	if out := joinFederated(t, c, s.sign(visitTicket("bob", ""))); out["code"] != "ticket_invalid" {
		t.Fatalf("plain ticket accepted from another server's page: %v", out)
	}

	c, _, _ = dialFrom(t, h, visitorOrigin)
	if out := joinFederated(t, c, s.sign(visitTicket("bob", "https://other.example"))); out["code"] != "ticket_invalid" {
		t.Fatalf("ticket bound to a different origin accepted: %v", out)
	}

	c, _, _ = dialFrom(t, h, visitorOrigin)
	if out := joinFederated(t, c, s.sign(visitTicket("https://visitor.example/users/bob", visitorOrigin))); out["success"] != true {
		t.Fatalf("visitor with its own ticket could not join: %v", out)
	}
}

func TestBoundTicketCannotBeUsedFromThisServersOwnPage(t *testing.T) {
	s, h := startFederated(t, true)
	for _, origin := range []string{homeOrigin, ""} {
		c, _, err := dialFrom(t, h, origin)
		if err != nil {
			t.Fatal(err)
		}
		if out := joinFederated(t, c, s.sign(visitTicket("bob", visitorOrigin))); out["code"] != "ticket_invalid" {
			t.Fatalf("bound ticket accepted from %q: %v", origin, out)
		}
	}
	c, _, _ := dialFrom(t, h, homeOrigin)
	if out := joinFederated(t, c, s.sign(visitTicket("alice", ""))); out["success"] != true {
		t.Fatalf("own page could not join with a plain ticket: %v", out)
	}
}

func TestOtherOriginsRejectedWhenFederatedVisitsAreOff(t *testing.T) {
	_, h := startFederated(t, false)
	if _, res, err := dialFrom(t, h, visitorOrigin); err == nil || res == nil || res.StatusCode != http.StatusForbidden {
		t.Fatalf("upgrade from another origin was not refused: %v", err)
	}
	// 形の崩れた Origin は FederatedVisits でも受けない
	_, fh := startFederated(t, true)
	if _, _, err := dialFrom(t, fh, "https://visitor.example/path"); err == nil {
		t.Fatal("malformed origin accepted")
	}
}

func TestAdminTicketCarriesValidatedOrigin(t *testing.T) {
	s, h := startFederated(t, true)
	code, grant := call(t, h, "POST", "/instances/a/tickets", Object{"userId": "https://visitor.example/users/bob", "name": "bob", "origin": visitorOrigin}, true)
	if code != 200 {
		t.Fatalf("ticket with origin: %d %v", code, grant)
	}
	claims, err := s.verify(str(grant["token"]), "a")
	if err != nil || claims.Origin != visitorOrigin || claims.Subject != "https://visitor.example/users/bob" {
		t.Fatalf("origin not bound: %+v %v", claims, err)
	}
	for _, bad := range []string{"https://visitor.example/", "https://u:p@visitor.example", "ftp://visitor.example", "visitor.example", "https://visitor.example?x=1"} {
		if code, _ := call(t, h, "POST", "/instances/a/tickets", Object{"userId": "bob", "origin": bad}, true); code != 400 {
			t.Fatalf("invalid origin %q accepted: %d", bad, code)
		}
	}
}

func TestValidOrigin(t *testing.T) {
	for _, ok := range []string{"https://a.example", "http://localhost:3200", "https://a.example:8443"} {
		if !validOrigin(ok) {
			t.Fatalf("%q rejected", ok)
		}
	}
	for _, ng := range []string{"", "null", "https://a.example/", "https://a.example/x", "javascript:alert(1)", "https://" + strings.Repeat("a", 300) + ".example"} {
		if validOrigin(ng) {
			t.Fatalf("%q accepted", ng)
		}
	}
}
