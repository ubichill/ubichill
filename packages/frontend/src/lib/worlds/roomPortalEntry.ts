import { type Instance, isFullFor } from '@ubichill/shared';
import { InstanceNotFoundError } from '@/world';

/** 部屋に入れるかを決めるもの。人数で変わるので、ワールドの名前・サムネイルと違って覚えておかずに引き直す。 */
export type RoomStatus = Pick<Instance, 'canJoin' | 'leaderId' | 'stats'>;

/** ポータルの先の部屋に入れないわけ。unknown は確かめられなかった（通信・サーバーの失敗）。 */
export type RoomPortalRefusal = 'gone' | 'closed' | 'full' | 'unknown';

export const ROOM_PORTAL_REFUSAL_MESSAGES: Record<RoomPortalRefusal, string> = {
    gone: 'ポータルの先の部屋はもうありません',
    closed: 'ポータルの先の部屋には入れません',
    full: 'ポータルの先の部屋は満員です',
    unknown: 'ポータルの先の部屋を確かめられませんでした',
};

/** 見る人が部屋に入れないわけ（公開範囲・招待、満員。部屋を作った人は満員でも入れる）。入れるなら null。 */
export function roomRefusal(room: RoomStatus, viewerId: string | null): 'closed' | 'full' | null {
    if (room.canJoin === false) return 'closed';
    return isFullFor(room, viewerId) ? 'full' : null;
}

/** 部屋を引けなかったわけ。無い・見る人に見えない部屋（404）は gone。 */
export const roomLookupFailure = (error: unknown): 'gone' | 'unknown' =>
    error instanceof InstanceNotFoundError ? 'gone' : 'unknown';

/**
 * 今の部屋を出る直前に、ポータルの先の部屋を引き直して入れるかを確かめる（ポータルの鍵は少し前に引いたもの）。
 * 入れない・確かめられなければわけを返し、呼ぶ側は今の部屋に残る。
 */
export function roomPortalRefusal(
    fetchRoom: (address: string) => Promise<RoomStatus>,
    address: string,
    viewerId: string | null,
): Promise<RoomPortalRefusal | null> {
    return fetchRoom(address).then((room) => roomRefusal(room, viewerId), roomLookupFailure);
}
