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

/**
 * 部屋を引くのを待つ上限（ms）。応答の無い問い合わせで、その部屋の引き直しや移る前の確認を止め続けない。
 * ほかのサーバーの部屋は backend が部屋のサーバーに尋ねるので、その上限（対応の確認・部屋の作りの取得 10 秒・
 * ワールドの確認 5 秒で、合わせて 25 秒ほど）より長くする（遅くても答えるサーバーの部屋を「確かめられない」にしない）。
 */
export const ROOM_STATUS_TIMEOUT_MS = 30_000;

/** ms のうちに決まらなければ失敗にし、start に渡した signal で問い合わせも取り消す。 */
export function withinTime<T>(start: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
    const controller = new AbortController();
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
            controller.abort();
            reject(new Error('timeout'));
        }, ms);
        start(controller.signal).then(
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
    fetchRoom: (address: string, signal?: AbortSignal) => Promise<RoomStatus | null>,
    address: string,
    viewerId: string | null,
    timeoutMs = ROOM_STATUS_TIMEOUT_MS,
): Promise<RoomPortalRefusal | null> {
    return withinTime((signal) => fetchRoom(address, signal), timeoutMs).then(
        (room) => (room ? roomRefusal(room, viewerId) : 'gone'),
        () => 'unknown' as const,
    );
}
