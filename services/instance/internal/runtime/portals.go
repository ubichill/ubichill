package runtime

import (
	"errors"
	"math"
	"regexp"
	"sort"
	"strings"
	"time"
)

// 部屋へのポータル。数字は packages/shared/src/world/roomPortal.ts の ROOM_PORTAL と同じにする。
// 利用者は core:* を作れない・書き換えられない・消せない（events.go）ので、インスタンスが core:portal の Entity として作り、
// 期限が来たら消す。置いた人が部屋を出ても消さない（先に通った人を友だちが追う）。
const (
	roomPortalLifetime   = 180 * time.Second
	roomPortalWidth      = 200
	roomPortalHeight     = 230
	roomPortalCooldown   = 3 * time.Second
	maxRoomPortals       = 64
	maxRoomAddressLength = 320
)

var (
	errPortalRoom     = errors.New("行き先の部屋が正しくありません")
	errPortalPosition = errors.New("不正な座標です")
	errPortalTooFast  = errors.New("少し待ってから置き直してください")
	errPortalTooMany  = errors.New("この部屋に置けるポータルの数を超えています")
	errPortalFull     = errors.New("インスタンスの容量を超えています")
)

var (
	roomIDPattern       = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)
	serverDomainPattern = regexp.MustCompile(`^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:\d{1,5})?$`)
)

// validRoomAddress は shared の isRoomPortalAddress（自分のドメインを空にした parseRoomAddress が null でない）と同じ判定。
// 小文字にするのは ASCII だけ（strings.ToLower は 'İ' を 'i' にして、JS の toLowerCase が断る住所を通してしまう）。
// 逆に JS が通して Go が断るのは、toLowerCase で 'k' になる KELVIN SIGN だけ。
func validRoomAddress(value string) bool {
	if len(value) > maxRoomAddressLength {
		return false
	}
	at := strings.LastIndexByte(value, '@')
	if at < 0 {
		return roomIDPattern.MatchString(value)
	}
	domain := strings.Map(func(c rune) rune {
		if 'A' <= c && c <= 'Z' {
			return c + ('a' - 'A')
		}
		return c
	}, value[at+1:])
	return roomIDPattern.MatchString(value[:at]) && len(domain) <= 253 && serverDomainPattern.MatchString(domain)
}

// isRoomPortal は部屋へのポータルか。ワールドの定義の Entity は ownerId が null（shared の flattenGameObject）で、
// ワールドに置く core:portal の data は {world, label} だけ（strict）なので、どちらでも当たらない。
func isRoomPortal(e Object) bool {
	if str(e["type"]) != "core:portal" || str(e["ownerId"]) == "" {
		return false
	}
	data, _ := e["data"].(map[string]any)
	_, ok := data["room"]
	return ok
}

func portalExpiresAt(e Object) int64 {
	data, _ := e["data"].(map[string]any)
	return int64(num(data["expiresAt"]))
}

// roomPortals は keep に合う部屋へのポータルの ID を置いた順に返す。
func (r *Room) roomPortals(keep func(Object) bool) []string {
	ids := []string{}
	for id, e := range r.entities {
		if isRoomPortal(e) && keep(e) {
			ids = append(ids, id)
		}
	}
	sort.Slice(ids, func(i, j int) bool { return r.order[ids[i]] < r.order[ids[j]] })
	return ids
}

func (r *Room) portalsOf(userID string) []string {
	return r.roomPortals(func(e Object) bool { return str(e["ownerId"]) == userID })
}

func (r *Room) dropPortals(ids []string) {
	for _, id := range ids {
		r.drop(id)
		r.broadcast("entity:deleted", id, nil, false)
	}
}

// openPortal は m の部屋へのポータルを置く（前のものは消す）。置いた本人を含む全員に配る（クライアントは先に足さない）。
func (r *Room) openPortal(m *member, userID string, data Object) error {
	room, _ := data["room"].(string)
	if !validRoomAddress(room) {
		return errPortalRoom
	}
	x, okX := data["x"].(float64)
	y, okY := data["y"].(float64)
	if !okX || !okY || math.IsNaN(x) || math.IsNaN(y) || math.Abs(x) > 1e7 || math.Abs(y) > 1e7 {
		return errPortalPosition
	}
	t := Object{"x": x - roomPortalWidth/2, "y": y - roomPortalHeight/2, "z": float64(0), "w": float64(roomPortalWidth), "h": float64(roomPortalHeight), "scale": float64(1), "rotation": float64(0)}
	// 端の座標では左上が範囲を出る。通すと引っ越し先の newRoom が部屋ごと断るので、ここで断る
	if _, ok := transform(t, false); !ok {
		return errPortalPosition
	}
	now := r.now()
	if now.Sub(m.lastPortal) < roomPortalCooldown {
		return errPortalTooFast
	}
	own := r.portalsOf(userID)
	if len(r.roomPortals(func(Object) bool { return true }))-len(own) >= maxRoomPortals {
		return errPortalTooMany
	}
	e := Object{
		"id": newID(), "type": "core:portal", "ownerId": userID, "lockedBy": nil, "transform": t,
		// 持ち主は先に通って部屋を出ることが多く、そのあとは参加者の一覧から名前を引けないので、名前も入れる
		"data": Object{"room": room, "expiresAt": float64(now.Add(r.portalLifetime).UnixMilli()), "ownerName": str(m.user["name"])},
	}
	if len(r.entities)-len(own) >= 10000 || !r.fits(str(e["id"]), e) {
		return errPortalFull
	}
	m.lastPortal = now
	r.dropPortals(own)
	r.put(str(e["id"]), e)
	r.broadcast("entity:created", e, nil, false)
	r.armPortalsLocked()
	return nil
}

// closePortal は userID の置いたポータルを消す。無くても成功にする。
func (r *Room) closePortal(userID string) {
	own := r.portalsOf(userID)
	if len(own) == 0 {
		return
	}
	r.dropPortals(own)
	r.armPortalsLocked()
}

// armPortalsLocked は一番早く消えるポータルの時刻にタイマーを張り直す（部屋に 1 つ）。r.mu の下で呼ぶ。
// 凍結の間は張らない（引っ越し先の arrive か、取りやめた thaw で張り直す）。
func (r *Room) armPortalsLocked() {
	r.stopPortalsLocked()
	if r.closed || r.migrating {
		return
	}
	next, found := int64(math.MaxInt64), false
	for _, e := range r.entities {
		if isRoomPortal(e) {
			next, found = min(next, portalExpiresAt(e)), true
		}
	}
	if !found {
		return
	}
	// Sub は桁あふれせず飽和する（ありえない expiresAt でも、0 で回り続けない）
	r.portalTimer = time.AfterFunc(max(time.UnixMilli(next).Sub(r.now()), 0), r.expirePortals)
}

// expirePortals は期限の来たポータルを消す。止めそこねた古いタイマーから呼ばれても、期限の来たものを消して張り直すだけ。
func (r *Room) expirePortals() {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.migrating || !r.usableLocked() {
		return
	}
	now := r.now().UnixMilli()
	r.dropPortals(r.roomPortals(func(e Object) bool { return portalExpiresAt(e) <= now }))
	r.armPortalsLocked()
}

func (r *Room) stopPortalsLocked() {
	if r.portalTimer != nil {
		r.portalTimer.Stop()
		r.portalTimer = nil
	}
}
