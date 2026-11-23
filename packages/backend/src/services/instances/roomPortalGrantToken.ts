import { createHmac } from 'node:crypto';
import { ROOM_PORTAL_GRANT, type RoomPortalGrantClaims } from '@ubichill/shared';

/**
 * 部屋へのポータルを置く許可の鍵。Go のインスタンス（portals.go の portalGrantKey）と同じく管理トークンから派生する
 * （管理トークンそのものを別の用途の鍵にしない。管理トークンを持つ者は管理 API で入室チケットも出せるので権限は広がらない）。
 */
export const roomPortalGrantKey = (adminToken: string): Buffer =>
    createHmac('sha256', adminToken).update(ROOM_PORTAL_GRANT.KEY_LABEL).digest();

/** 許可に署名する（形は shared の ROOM_PORTAL_GRANT）。項目の順を決めておく（例のバイト列をテストで固定する）。 */
export function signRoomPortalGrant(key: Buffer, claims: RoomPortalGrantClaims): string {
    const payload = Buffer.from(
        JSON.stringify({ room: claims.room, userId: claims.userId, exp: claims.exp }),
        'utf8',
    ).toString('base64url');
    return `${payload}.${createHmac('sha256', key).update(payload).digest('base64url')}`;
}
