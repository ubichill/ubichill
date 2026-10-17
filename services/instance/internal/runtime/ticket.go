package runtime

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"time"
)

type ticket struct {
	Instance string `json:"instance"`
	Subject  string `json:"subject"`
	Expires  int64  `json:"expires"`
	Kind     string `json:"kind"`
	// Name is the display name the SNS vouches for. When present it replaces the name the client sends.
	Name string `json:"name,omitempty"`
}

// claims は署名する値。部屋の世代 (Gen, Epoch) を入れ、同じ部屋 ID で作り直された部屋に前の部屋のチケットを通さない
// （署名鍵は全 Pod・再起動をまたいで同じなので、世代が無いと区別できない）。
type claims struct {
	ticket
	Gen   string `json:"gen,omitempty"`
	Epoch int64  `json:"epoch,omitempty"`
}

// issued は、このチケットが今の部屋（同じ世代）に向けて発行されたかを返す。
func (r *Room) issued(c claims) bool { return c.Gen == r.gen && c.Epoch == r.epoch }

func newID() string {
	b := make([]byte, 24)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return base64.RawURLEncoding.EncodeToString(b)
}

// ticketKeyLabel は管理トークンからチケット鍵を派生するときの用途の名前。変えると発行済みのチケットがすべて無効になる。
const ticketKeyLabel = "ubichill instance ticket v1"

// ticketKey は全 Pod・再起動の前後で同じ鍵になるよう、設定から決める。
// 管理トークンを持つ者は管理 API でチケットを発行できるので、そこから派生しても権限は広がらない。
// 派生にするのは、管理トークンそのものを別の用途の鍵に使わないため。
// どちらも無い単体モード（--guests）だけ起動ごとの乱数にする。
func ticketKey(c Config) []byte {
	if c.TicketKey != "" {
		return []byte(c.TicketKey)
	}
	if c.AdminToken != "" {
		mac := hmac.New(sha256.New, []byte(c.AdminToken))
		mac.Write([]byte(ticketKeyLabel))
		return mac.Sum(nil)
	}
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		panic(err)
	}
	return key
}

// sign は手元の部屋の今の世代でチケットに署名する（部屋が無ければ世代なし）。
func (s *Server) sign(t ticket) string { return s.signFor(s.room(t.Instance), t) }
func (s *Server) signFor(room *Room, t ticket) string {
	c := claims{ticket: t}
	if room != nil {
		c.Gen, c.Epoch = room.gen, room.epoch
	}
	payload := base64.RawURLEncoding.EncodeToString(encoded(c))
	mac := hmac.New(sha256.New, s.key)
	mac.Write([]byte(payload))
	return payload + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

// verify は署名・部屋・期限・種別を確かめる。世代は部屋と照らす側（room.issued）で確かめる。
func (s *Server) verify(value, instance string) (claims, error) {
	var t claims
	parts := strings.Split(value, ".")
	if len(parts) != 2 || len(value) > 4096 {
		return t, errors.New("invalid ticket")
	}
	sig, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return t, err
	}
	mac := hmac.New(sha256.New, s.key)
	mac.Write([]byte(parts[0]))
	if !hmac.Equal(sig, mac.Sum(nil)) {
		return t, errors.New("invalid signature")
	}
	body, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return t, err
	}
	if err = json.Unmarshal(body, &t); err != nil {
		return t, err
	}
	if t.Instance != instance || t.Subject == "" || t.Expires <= time.Now().Unix() || (t.Kind != "member" && t.Kind != "guest") {
		return t, errors.New("expired or wrong instance ticket")
	}
	return t, nil
}
