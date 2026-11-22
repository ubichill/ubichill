import { type Instance, isFullFor } from '@ubichill/shared';

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

/** 部屋を引くのを待つ上限（ms）。応答の無い問い合わせで、その部屋の引き直しや移る前の確認を止め続けない。 */
export const ROOM_STATUS_TIMEOUT_MS = 8_000;

/** ms のうちに決まらなければ失敗にする。 */
export function withinTime<T>(promise: Promise<T>, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timeout')), ms);
        promise.then(
            (value) => {
                clearTimeout(timer);
                resolve(value);
            },
            (error: unknown) => {
                clearTimeout(timer);
                reject(error);
            },
        );
    });
}

/**
 * 今の部屋を出る直前に、ポータルの先の部屋を引き直して入れるかを確かめる（ポータルの鍵は少し前に引いたもの）。
 * fetchRoom は無い・見る人に見えない部屋を null にし、確かめられなければ失敗する（時間切れも同じ）。
 * 入れない・確かめられなければわけを返し、呼ぶ側は今の部屋に残る。
 */
export function roomPortalRefusal(
    fetchRoom: (address: string) => Promise<RoomStatus | null>,
    address: string,
    viewerId: string | null,
    timeoutMs = ROOM_STATUS_TIMEOUT_MS,
): Promise<RoomPortalRefusal | null> {
    return withinTime(fetchRoom(address), timeoutMs).then(
        (room) => (room ? roomRefusal(room, viewerId) : 'gone'),
        () => 'unknown' as const,
    );
}
