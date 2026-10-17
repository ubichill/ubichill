package runtime

import (
	"encoding/json"
	"errors"
	"math"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"
)

var componentType = regexp.MustCompile(`^[a-z0-9-]+:[a-zA-Z0-9_-]+$`)

func transform(value any, partial bool) (Object, bool) {
	v, ok := value.(map[string]any)
	if !ok {
		return nil, false
	}
	keys := map[string]bool{"x": true, "y": true, "z": true, "w": true, "h": true, "scale": true, "rotation": true}
	if !partial && len(v) != len(keys) {
		return nil, false
	}
	for k, raw := range v {
		n, ok := raw.(float64)
		if !keys[k] || !ok || math.IsNaN(n) || math.IsInf(n, 0) {
			return nil, false
		}
		if (k == "w" || k == "h") && (n < 0 || n > 1e6) || k == "scale" && (n <= 0 || n > 1000) || (k == "x" || k == "y" || k == "z") && math.Abs(n) > 1e7 {
			return nil, false
		}
	}
	return v, true
}
func position(value any) bool {
	v, ok := value.(map[string]any)
	if !ok {
		return false
	}
	for _, k := range []string{"x", "y"} {
		n, ok := v[k].(float64)
		if !ok || math.Abs(n) > 1e7 {
			return false
		}
	}
	return true
}
func validName(name string) bool {
	return utf8.RuneCountInString(strings.TrimSpace(name)) >= 1 && utf8.RuneCountInString(name) <= 30
}
func validUser(v Object) bool {
	return validName(str(v["name"])) && position(v["position"]) && validStatus(str(v["status"]))
}
func validStatus(v string) bool {
	return v == "online" || v == "busy" || v == "dnd" || v == "away" || v == "offline"
}
func ref(v any) bool { return len(str(v)) > 0 && len(str(v)) <= 200 }
func (r *Room) handle(p *peer, f Frame) {
	r.mu.Lock()
	defer r.mu.Unlock()
	m := r.members[p.userID]
	if r.closed || !r.now().Before(r.deadline) || m == nil || m.peer != p {
		p.reject(f.ID, "参加していません")
		// 自己停止の期限を過ぎていれば、拒否を届けてから閉じる
		r.usableLocked()
		return
	}
	data, _ := object(f.Data)
	switch f.Event {
	case "cursor:move":
		if !position(data["position"]) {
			p.reject(f.ID, "不正な座標です")
			return
		}
		m.user["position"] = data["position"]
		m.user["lastActiveAt"] = time.Now().UnixMilli()
		out := Object{"userId": p.userID, "position": data["position"]}
		if held, exists := data["heldEntityId"]; exists && (held == nil || (len(str(held)) > 0 && len(str(held)) <= 64)) {
			out["heldEntityId"] = held
		}
		r.broadcast("cursor:moved", out, p, true)
	case "status:update":
		var status string
		if json.Unmarshal(f.Data, &status) != nil || !validStatus(status) {
			p.reject(f.ID, "不正なステータスです")
			return
		}
		m.user["status"] = status
		r.broadcast("status:changed", Object{"userId": p.userID, "status": status}, p, false)
	case "entity:create":
		if f.ID == "" {
			p.reject("", "request ID is required")
			return
		}
		if _, exists := data["id"]; exists {
			p.reject(f.ID, "id は指定できません")
			return
		}
		t, ok := transform(data["transform"], false)
		_, validData := data["data"].(map[string]any)
		typ := str(data["type"])
		if !ok || !validData || len(f.Data) > 65536 || len(r.entities) >= 10000 || !componentType.MatchString(typ) || strings.HasPrefix(typ, "core:") {
			p.reject(f.ID, "不正なエンティティです")
			return
		}
		e := Object{"id": newID(), "type": typ, "ownerId": p.userID, "lockedBy": nil, "transform": t, "data": data["data"]}
		for _, key := range []string{"entityId", "parentEntityId"} {
			if value, exists := data[key]; exists {
				if !ref(value) {
					p.reject(f.ID, "不正な参照です")
					return
				}
				e[key] = value
			}
		}
		if !r.fits(str(e["id"]), e) {
			p.reject(f.ID, "インスタンスの容量を超えています")
			return
		}
		r.put(str(e["id"]), e)
		p.reply(f.ID, Object{"success": true, "entity": e})
		r.broadcast("entity:created", e, p, false)
	case "entity:patch":
		patch, ok := data["patch"].(map[string]any)
		id := str(data["entityId"])
		e := r.entities[id]
		if !ok || e == nil || len(f.Data) > 65536 {
			p.reject(f.ID, "不正なパッチです")
			return
		}
		if strings.HasPrefix(str(e["type"]), "core:") || str(e["lockedBy"]) != "" && str(e["lockedBy"]) != p.userID {
			p.reject(f.ID, "更新できません")
			return
		}
		for _, key := range []string{"id", "type", "entityId", "parentEntityId"} {
			if _, exists := patch[key]; exists {
				p.reject(f.ID, "識別子は変更できません")
				return
			}
		}
		clean := Object{}
		updated := clone(e)
		if value, exists := patch["transform"]; exists {
			t, ok := transform(value, true)
			if !ok {
				p.reject(f.ID, "不正なtransformです")
				return
			}
			clean["transform"] = t
			for k, v := range t {
				updated["transform"].(map[string]any)[k] = v
			}
		}
		if value, exists := patch["data"]; exists {
			d, ok := value.(map[string]any)
			if !ok {
				p.reject(f.ID, "不正なdataです")
				return
			}
			clean["data"] = d
			for k, v := range d {
				updated["data"].(map[string]any)[k] = v
			}
		}
		if value, exists := patch["lockedBy"]; exists {
			clean["lockedBy"] = nil
			if value != nil {
				if str(e["lockedBy"]) != p.userID && r.locksHeldBy(p.userID) >= maxLocksPerMember {
					p.reject(f.ID, "同時に持てる数を超えています")
					return
				}
				clean["lockedBy"] = p.userID
			}
			updated["lockedBy"] = clean["lockedBy"]
		}
		if len(encoded(updated)) > 65536 {
			p.reject(f.ID, "エンティティが大きすぎます")
			return
		}
		if !r.fits(id, updated) {
			p.reject(f.ID, "インスタンスの容量を超えています")
			return
		}
		r.put(id, updated)
		r.broadcast("entity:patched", Object{"entityId": id, "patch": clean}, p, false)
		p.reply(f.ID, Object{"success": true})
	case "entity:ephemeral":
		if !ref(data["entityId"]) || r.entities[str(data["entityId"])] == nil || len(f.Data) > 32768 {
			p.reject(f.ID, "不正な一時データです")
			return
		}
		r.broadcast(f.Event, Object{"entityId": data["entityId"], "data": data["data"]}, p, true)
	case "entity:delete":
		var id string
		if json.Unmarshal(f.Data, &id) != nil {
			p.reject(f.ID, "不正なidです")
			return
		}
		e := r.entities[id]
		if e == nil || strings.HasPrefix(str(e["type"]), "core:") || str(e["lockedBy"]) != "" && str(e["lockedBy"]) != p.userID || str(e["ownerId"]) != "" && str(e["ownerId"]) != p.userID {
			p.reject(f.ID, "削除できません")
			return
		}
		r.drop(id)
		r.broadcast("entity:deleted", id, p, false)
		p.reply(f.ID, Object{"success": true})
	case "state:get":
		key := str(data["key"])
		if !validStateKey(key) {
			p.reject(f.ID, "不正なキーです")
			return
		}
		p.reply(f.ID, Object{"success": true, "entry": r.state[key], "serverTime": r.now().UnixMilli()})
	case "state:update":
		entry, err := r.updateState(f.Data, p.userID)
		if errors.Is(err, errStateConflict) {
			// 負けた側が今の値に合わせ直せるよう、競合では今の値を返す
			key := str(data["key"])
			p.reply(f.ID, Object{"success": false, "error": err.Error(), "code": "conflict", "entry": r.state[key], "serverTime": r.now().UnixMilli()})
			return
		}
		if err != nil {
			p.reject(f.ID, err.Error())
			return
		}
		p.reply(f.ID, Object{"success": true, "entry": entry, "serverTime": r.now().UnixMilli()})
		r.broadcast("state:changed", entry, p, false)
	default:
		p.reject(f.ID, "unknown event")
	}
}
