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
func validUser(v Object) bool {
	return utf8.RuneCountInString(strings.TrimSpace(str(v["name"]))) >= 1 && utf8.RuneCountInString(str(v["name"])) <= 30 && position(v["position"]) && validStatus(str(v["status"]))
}
func validStatus(v string) bool {
	return v == "online" || v == "busy" || v == "dnd" || v == "away" || v == "offline"
}
func ref(v any) bool { return len(str(v)) > 0 && len(str(v)) <= 200 }
func (r *Room) handle(p *peer, f Frame) {
	r.mu.Lock()
	defer r.mu.Unlock()
	m := r.members[p.userID]
	if r.closed || m == nil || m.peer != p {
		p.reject(f.ID, "参加していません")
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
				clean["lockedBy"] = p.userID
			}
			updated["lockedBy"] = clean["lockedBy"]
		}
		if len(encoded(updated)) > 65536 {
			p.reject(f.ID, "エンティティが大きすぎます")
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
	case "media:timeline:get":
		id := str(data["sessionId"])
		if id == "" || len(id) > 256 {
			p.reject(f.ID, "不正なsessionIdです")
			return
		}
		p.reply(f.ID, Object{"success": true, "timeline": r.timelines[id], "serverTime": time.Now().UnixMilli()})
	case "media:timeline:update":
		result, err := r.media(data, p.userID)
		if err != nil {
			p.reply(f.ID, Object{"success": false, "error": err.Error(), "timeline": r.timelines[str(data["sessionId"])], "serverTime": time.Now().UnixMilli()})
			return
		}
		p.reply(f.ID, Object{"success": true, "timeline": result, "serverTime": time.Now().UnixMilli()})
		r.broadcast("media:timeline", result, p, false)
	case "media:sync", "media:state-request", "media:state-response":
		if len(f.Data) > 32768 {
			p.reject(f.ID, "メディアデータが大きすぎます")
			return
		}
		if f.Event == "media:state-request" {
			r.broadcast(f.Event, Object{"fromSocketId": p.id}, p, false)
		} else if f.Event == "media:state-response" {
			target := str(data["toSocketId"])
			delete(data, "toSocketId")
			for _, m := range r.members {
				if m.peer != nil && m.peer.id == target {
					m.peer.send(Frame{Event: f.Event, Data: encoded(data)}, false)
				}
			}
		} else {
			r.broadcast(f.Event, data, p, false)
		}
	default:
		p.reject(f.ID, "unknown event")
	}
}
func (r *Room) media(v Object, userID string) (Object, error) {
	id := str(v["sessionId"])
	mediaID := str(v["mediaId"])
	action := str(v["action"])
	current := r.timelines[id]
	bad := errors.New("不正なメディア更新です")
	if id == "" || len(id) > 256 || mediaID == "" || len(mediaID) > 512 {
		return nil, bad
	}
	if action != "load" && action != "play" && action != "pause" && action != "seek" && action != "ended" && action != "metadata" {
		return nil, bad
	}
	for _, k := range []string{"position", "duration", "playbackRate", "expectedRevision"} {
		if raw, exists := v[k]; exists {
			if k == "duration" && raw == nil {
				continue
			}
			n, ok := raw.(float64)
			if !ok || n < 0 || k == "playbackRate" && (n == 0 || n > 4) || k == "expectedRevision" && (math.Trunc(n) != n || n > 9007199254740991) {
				return nil, bad
			}
		}
	}
	if rev, exists := v["expectedRevision"]; exists && current != nil && num(rev) != num(current["revision"]) {
		return nil, errors.New("メディア状態が既に更新されています")
	}
	if action != "load" && (current == nil || str(current["mediaId"]) != mediaID) {
		return nil, errors.New("再生対象が一致しません")
	}
	if action == "load" && current != nil && str(current["mediaId"]) == mediaID {
		return current, nil
	}
	if current == nil && len(r.timelines) >= 1000 {
		return nil, errors.New("メディア数の上限です")
	}
	now := float64(time.Now().UnixMilli())
	rate := float64(1)
	revision := float64(1)
	pos := float64(0)
	if current != nil {
		rate = num(current["playbackRate"])
		revision = num(current["revision"]) + 1
		pos = num(current["anchorTime"])
		if str(current["phase"]) == "playing" {
			pos += math.Max(0, now-num(current["anchorServerTime"])) / 1000 * rate
		}
		if current["duration"] != nil {
			pos = math.Min(pos, num(current["duration"]))
		}
	}
	if raw, exists := v["playbackRate"]; exists {
		rate = num(raw)
	}
	var next Object
	if action == "load" {
		next = Object{"sessionId": id, "mediaId": mediaID, "phase": "paused", "anchorTime": num(v["position"]), "duration": v["duration"]}
	} else {
		next = clone(current)
		next["anchorTime"] = pos
		switch action {
		case "play":
			next["phase"] = "playing"
		case "pause":
			next["phase"] = "paused"
		case "ended":
			next["phase"] = "ended"
			if next["duration"] != nil {
				next["anchorTime"] = next["duration"]
			}
		case "seek":
			if raw, exists := v["position"]; exists {
				next["anchorTime"] = raw
			}
		case "metadata":
			next["duration"] = v["duration"]
		}
	}
	next["anchorServerTime"] = now
	next["playbackRate"] = rate
	next["revision"] = revision
	next["updatedBy"] = userID
	r.timelines[id] = next
	return next, nil
}
