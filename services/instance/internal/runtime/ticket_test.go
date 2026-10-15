package runtime

import (
	"bytes"
	"strings"
	"testing"
	"time"
)

func memberTicket(instance string) ticket {
	return ticket{instance, "alice", time.Now().Add(time.Minute).Unix(), "member", ""}
}

func TestTicketKeyIsSharedBetweenServersWithTheSameAdminToken(t *testing.T) {
	token := strings.Repeat("a", 32)
	podA := New(Config{AdminToken: token})
	podB := New(Config{AdminToken: token})
	if _, err := podB.verify(podA.sign(memberTicket("a")), "a"); err != nil {
		t.Fatalf("pod B rejected a ticket from pod A: %v", err)
	}
	if _, err := podA.verify(podB.sign(memberTicket("a")), "a"); err != nil {
		t.Fatalf("pod A rejected a ticket from pod B: %v", err)
	}
	// 再起動しても同じ鍵になり、ゲストの再接続情報（24 時間）が無効にならない
	restarted := New(Config{AdminToken: token, Guests: true})
	if _, err := restarted.verify(podA.sign(ticket{"a", "guest", time.Now().Add(24 * time.Hour).Unix(), "guest", ""}), "a"); err != nil {
		t.Fatalf("restarted server rejected a guest ticket: %v", err)
	}
}

func TestTicketKeyRejectsTicketsFromAnotherAdminToken(t *testing.T) {
	a := New(Config{AdminToken: strings.Repeat("a", 32)})
	b := New(Config{AdminToken: strings.Repeat("b", 32)})
	if _, err := b.verify(a.sign(memberTicket("a")), "a"); err == nil {
		t.Fatal("accepted a ticket signed with another admin token")
	}
}

func TestTicketKeyIsNotTheRawAdminToken(t *testing.T) {
	token := strings.Repeat("a", 32)
	if bytes.Equal(ticketKey(Config{AdminToken: token}), []byte(token)) {
		t.Fatal("the admin token itself must not be the ticket key")
	}
	raw := &Server{key: []byte(token)}
	if _, err := New(Config{AdminToken: token}).verify(raw.sign(memberTicket("a")), "a"); err == nil {
		t.Fatal("accepted a ticket signed with the raw admin token")
	}
}

func TestExplicitTicketKeyTakesPrecedence(t *testing.T) {
	key := strings.Repeat("k", 32)
	a := New(Config{AdminToken: strings.Repeat("a", 32), TicketKey: key})
	b := New(Config{AdminToken: strings.Repeat("b", 32), TicketKey: key})
	if _, err := b.verify(a.sign(memberTicket("a")), "a"); err != nil {
		t.Fatalf("servers sharing INSTANCE_TICKET_KEY must accept each other's tickets: %v", err)
	}
	derived := New(Config{AdminToken: strings.Repeat("a", 32)})
	if _, err := derived.verify(a.sign(memberTicket("a")), "a"); err == nil {
		t.Fatal("a derived key accepted a ticket signed with the explicit key")
	}
}

func TestStandaloneTicketKeyIsRandomPerStart(t *testing.T) {
	first := New(Config{Guests: true})
	second := New(Config{Guests: true})
	if len(first.key) != 32 || bytes.Equal(first.key, second.key) {
		t.Fatal("standalone mode must generate a fresh 32-byte key on every start")
	}
	if _, err := second.verify(first.sign(memberTicket("a")), "a"); err == nil {
		t.Fatal("a restarted standalone server accepted an old ticket")
	}
}
