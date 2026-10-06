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
}

func newID() string {
	b := make([]byte, 24)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return base64.RawURLEncoding.EncodeToString(b)
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
