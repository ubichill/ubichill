package runtime

import (
	"errors"
	"sort"
	"time"
)

// 見える・見えない（core:switch）。部屋は見えない Entity（GameObject）の ID だけを持ち、子が見えないかはクライアントが親から辿る。
// core:* の Entity はクライアントから作れず書き換えられない（events.go）ので、スイッチの対象は部屋の定義のままで信じてよい。

// switchInterval は 1 人がスイッチを押せる間隔（点滅させ続けて全員の画面を荒らさない）。
const switchInterval = 300 * time.Millisecond

var (
	errNotSwitch     = errors.New("スイッチではありません")
	errSwitchTooFast = errors.New("押すのが速すぎます")
)

func hiddenSet(ids []string) (map[string]bool, error) {
	if len(ids) > 10000 {
		return nil, errors.New("too many hidden entities")
	}
	set := make(map[string]bool, len(ids))
	for _, id := range ids {
		if id == "" || len(id) > 200 {
			return nil, errors.New("invalid hidden entity ID")
		}
		set[id] = true
	}
	return set, nil
}

func (r *Room) hiddenList() []string {
	if len(r.hidden) == 0 {
		return nil
	}
	ids := make([]string, 0, len(r.hidden))
	for id := range r.hidden {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return ids
}

// switchTargets は core:switch の data の対象（重なりは 1 つにする。2 回切り替えると何も起きないため）。
func switchTargets(e Object) []string {
	data, _ := e["data"].(map[string]any)
	raw, _ := data["targets"].([]any)
	seen := make(map[string]bool, len(raw))
	targets := make([]string, 0, len(raw))
	for _, v := range raw {
		id, ok := v.(string)
		if ok && ref(id) && !seen[id] {
			seen[id] = true
			targets = append(targets, id)
		}
	}
	return targets
}

// pressSwitch は対象のうち部屋にある Entity の見える・見えないを切り替える。変わったかを返す。
func (r *Room) pressSwitch(m *member, componentID string) (bool, error) {
	e := r.entities[componentID]
	if e == nil || str(e["type"]) != "core:switch" {
		return false, errNotSwitch
	}
	now := r.now()
	if now.Sub(m.lastSwitch) < switchInterval {
		return false, errSwitchTooFast
	}
	m.lastSwitch = now
	present := make(map[string]bool, len(r.entities))
	for _, other := range r.entities {
		present[str(other["entityId"])] = true
	}
	changed := false
	for _, id := range switchTargets(e) {
		if !present[id] {
			continue
		}
		if r.hidden[id] {
			delete(r.hidden, id)
		} else {
			r.hidden[id] = true
		}
		changed = true
	}
	return changed, nil
}

// nonNil は空の一覧を null ではなく [] で送る。
func nonNil(ids []string) []string {
	if ids == nil {
		return []string{}
	}
	return ids
}
