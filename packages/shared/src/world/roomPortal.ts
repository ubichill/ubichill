import { z } from 'zod';
import { parseRoomAddress } from '../federation/ubichill/roomAddress';

/**
 * 部屋で利用者が置くポータル。行き先はワールドではなく部屋（いっしょに来た人が同じ部屋に入れる）。どのワールドの部屋でも置ける。
 * インスタンスが `core:portal` の Entity として作り（利用者は core:* を直接作れない）、期限が来たら消す。
 * 部屋は作っては消えるので、ワールドの定義には書かない。数字は Go のインスタンス（services/instance）と同じにする。
 */
export const ROOM_PORTAL = {
    /** 置いてから消えるまで（ms）。行き先に作った新しい部屋も、この間は空でも残す */
    LIFETIME_MS: 60_000,
    /** Entity の大きさ（px）。行き先の名前・丸い窓・置いた人の名前が入る */
    WIDTH: 200,
    HEIGHT: 230,
    /** 続けて置き直せる間隔（ms） */
    COOLDOWN_MS: 3_000,
    /** 1 つの部屋に同時に置ける数（1 人 1 つ。置き直すと前のものは消える） */
    MAX_PER_ROOM: 64,
} as const;

/**
 * 部屋へのポータルを置く許可（backend が発行し、インスタンスが `portal:open` で確かめる）。プライベートのワールドの部屋への
 * ポータルを置けるのはその部屋を作った人だけ、という判定をサーバーで行うため。
 * 形: `base64url(JSON {room, userId, exp})` + `.` + `base64url(HMAC-SHA256(鍵, 前半))`。exp は epoch 秒。
 * 鍵は HMAC-SHA256(管理トークン, KEY_LABEL)。Go のインスタンス（services/instance の portals.go）と同じにする。
 */
export const ROOM_PORTAL_GRANT = {
    KEY_LABEL: 'ubichill room portal grant v1',
    TTL_SECONDS: 60,
} as const;

/** 許可が証明すること: userId がこの住所（`portal:open` の room と同じ文字列）へポータルを置いてよい。 */
export interface RoomPortalGrantClaims {
    room: string;
    userId: string;
    exp: number;
}

/** 行き先の部屋の住所（部屋のサーバーから見た形。このサーバーの部屋は ID、ほかのサーバーの部屋は `<ID>@<ドメイン>`）。 */
export const ROOM_PORTAL_ADDRESS_MAX_LENGTH = 320;

export const isRoomPortalAddress = (value: string): boolean =>
    value.length <= ROOM_PORTAL_ADDRESS_MAX_LENGTH && parseRoomAddress(value, '') !== null;

/** インスタンスが作る `core:portal` の data。ワールドに置くポータル（行き先はワールド）とは項目が違う。 */
export const RoomPortalDataSchema = z
    .object({
        room: z.string().refine(isRoomPortalAddress),
        /** 消える時刻（インスタンスの時計の epoch ms） */
        expiresAt: z.number().int().nonnegative(),
        /** 置いた人の表示名（インスタンスが入れる。持ち主が先に部屋を出ても出せるように） */
        ownerName: z.string().max(200),
    })
    .strict();

export type RoomPortalData = z.infer<typeof RoomPortalDataSchema>;

/**
 * 置かれたポータルの行き先を、見る人から見た部屋の住所にする。行き先は部屋のサーバーから見た住所で書かれているので、
 * ほかのサーバーの部屋（`<ID>@<ドメイン>`）にいる人には、そのドメインを付ける。自分のサーバーのドメインが付いた住所は
 * サーバーがこのサーバーの部屋として読む（parseRoomAddress）。
 */
export function roomPortalAddressFor(room: string, currentRoom: string): string {
    if (room.includes('@')) return room;
    const at = currentRoom.lastIndexOf('@');
    return at < 0 ? room : `${room}${currentRoom.slice(at)}`;
}

/**
 * 置く場所（ポータルの真ん中）。選んだ所を、ワールドからはみ出さないよう寄せる。
 * ワールドがポータルより小さいときは、ワールドの真ん中に置く。
 */
export function roomPortalCenter(
    view: { x: number; y: number },
    world: { width: number; height: number },
): { x: number; y: number } {
    const along = (value: number, size: number, extent: number) =>
        size <= extent ? size / 2 : Math.round(Math.min(Math.max(value, extent / 2), size - extent / 2));
    return {
        x: along(view.x, world.width, ROOM_PORTAL.WIDTH),
        y: along(view.y, world.height, ROOM_PORTAL.HEIGHT),
    };
}

/** 残りの割合（0〜1）。時計がずれていても範囲の外に出さない。 */
export function roomPortalRemaining(expiresAt: number, now: number): number {
    return Math.min(1, Math.max(0, (expiresAt - now) / ROOM_PORTAL.LIFETIME_MS));
}
