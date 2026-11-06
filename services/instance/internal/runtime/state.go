package runtime

import (
	"bytes"
	"encoding/json"
	"errors"
	"math"
	"unicode/utf8"
)

// 部屋の共有状態。値は意味を解釈しない JSON で、キーごとの revision による比較と交換だけを保証する。
// キーの名前空間（どの mod・どのメディアか）と値の意味は Host が決める。
const (
	maxStateKeyBytes   = 512
	maxStateValueBytes = 32 << 10
	maxStateKeys       = 1000
	// 1 部屋が共有状態に使うメモリの上限。キー数×値の上限（32MB）より小さく抑える。
	maxStateBytes = 4 << 20
	maxRevision   = 1<<53 - 1
)

type stateEntry struct {
	Key       string          `json:"key"`
	Value     json.RawMessage `json:"value"`
	Revision  int64           `json:"revision"`
	UpdatedAt int64           `json:"updatedAt"`
	UpdatedBy string          `json:"updatedBy"`
}

var (
	errStateConflict = errors.New("共有状態が既に更新されています")
	errStateInvalid  = errors.New("不正な共有状態です")
	errStateFull     = errors.New("共有状態の上限です")
)

func validStateKey(key string) bool {
	return key != "" && len(key) <= maxStateKeyBytes && utf8.ValidString(key)
}

func stateSize(e *stateEntry) int {
	if e == nil {
		return 0
	}
	return len(e.Key) + len(e.Value)
}

// updateState は expectedRevision が今の revision（無いキーは 0）と一致したときだけ値を置き換える。
func (r *Room) updateState(raw json.RawMessage, userID string) (*stateEntry, error) {
	var in struct {
		Key              *string         `json:"key"`
		Value            json.RawMessage `json:"value"`
		ExpectedRevision *float64        `json:"expectedRevision"`
	}
	if json.Unmarshal(raw, &in) != nil || in.Key == nil || in.Value == nil || in.ExpectedRevision == nil {
		return nil, errStateInvalid
	}
	key, expected := *in.Key, *in.ExpectedRevision
	if !validStateKey(key) || expected < 0 || expected > maxRevision || math.Trunc(expected) != expected {
		return nil, errStateInvalid
	}
	var value bytes.Buffer
	if json.Compact(&value, in.Value) != nil || value.Len() > maxStateValueBytes {
		return nil, errStateInvalid
	}
	current := r.state[key]
	revision := int64(0)
	if current != nil {
		revision = current.Revision
	}
	if int64(expected) != revision {
		return nil, errStateConflict
	}
	if revision >= maxRevision {
		return nil, errStateFull
	}
	if current == nil && len(r.state) >= maxStateKeys {
		return nil, errStateFull
	}
	next := &stateEntry{Key: key, Value: value.Bytes(), Revision: revision + 1, UpdatedAt: r.now().UnixMilli(), UpdatedBy: userID}
	size := r.stateBytes - stateSize(current) + stateSize(next)
	if size > maxStateBytes {
		return nil, errStateFull
	}
	r.stateBytes = size
	r.state[key] = next
	return next, nil
}
