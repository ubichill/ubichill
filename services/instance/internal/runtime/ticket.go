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
func (s *Server) sign(t ticket) string {
	payload := base64.RawURLEncoding.EncodeToString(encoded(t))
	mac := hmac.New(sha256.New, s.key)
	mac.Write([]byte(payload))
	return payload + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}
func (s *Server) verify(value, instance string) (ticket, error) {
	var t ticket
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
