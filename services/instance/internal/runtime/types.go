package runtime

import (
	"encoding/json"
	"github.com/ubichill/ubichill/services/instance/internal/protocol"
)

// Wire types are described by protocol/instance/{openapi,asyncapi}.yaml.
// Mod data stays opaque: the runtime does not execute mod code.
type Object = map[string]any

type Snapshot = protocol.Snapshot
type Definition = protocol.InstanceDefinition
type Presence = protocol.RuntimePresence
type Frame struct {
	Event   string          `json:"event,omitempty"`
	Data    json.RawMessage `json:"data,omitempty"`
	ID      string          `json:"id,omitempty"`
	ReplyTo string          `json:"replyTo,omitempty"`
}

func encoded(v any) json.RawMessage { b, _ := json.Marshal(v); return b }
func object(raw json.RawMessage) (Object, bool) {
	var v Object
	err := json.Unmarshal(raw, &v)
	return v, err == nil && v != nil
}
func str(v any) string              { s, _ := v.(string); return s }
func num(v any) float64             { n, _ := v.(float64); return n }
func clone(v Object) Object         { out, _ := object(encoded(v)); return out }
func failure(message string) Object { return Object{"success": false, "error": message} }
