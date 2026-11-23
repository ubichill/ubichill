import type { PortalTarget } from '@ubichill/core-components';
import { isPortalDestination, type WorldListItem } from '@ubichill/shared';
import type { PortalDestination, PortalLookup } from '@/world';
import { ROOM_STATUS_TIMEOUT_MS, type RoomStatus, roomRefusal, withinTime } from './roomPortalEntry';

/** 行き先を、ワールドを引く参照（`@handle/name`・ワールドの ID・URL）にする。 */
export function portalWorldRef(target: PortalTarget): string {
    switch (target.kind) {
        case 'share':
            return target.path;
        case 'id':
            return target.id;
        case 'url':
            return target.url;
    }
}

type WorldLook = Pick<WorldListItem, 'displayName' | 'thumbnail' | 'visibility'>;

const destinationOf = (world: WorldLook): PortalDestination => ({
    name: world.displayName,
    ...(world.thumbnail ? { thumbnail: world.thumbnail } : {}),
});

/** 部屋へのポータルの行き先を引く手段。部屋の詳細（無い・見る人に見えなければ null）と、満員の判定に使う見る人。 */
export interface PortalRoomSource {
    fetch: (address: string, signal?: AbortSignal) => Promise<(RoomStatus & { world: WorldLook }) | null>;
    viewerId: string | null;
}

/** 部屋に入れるかを、引いてからこの間は引き直さない（ms）。同じ部屋へのポータルがいくつあっても、引くのはこの間に 1 回。 */
export const ROOM_STATUS_TTL_MS = 5_000;

/** 部屋を一度も確かめられていない（前の結果が無いまま、通信・サーバーの失敗）。 */
export const UNKNOWN_ROOM: PortalDestination = { unknown: true };

/**
 * ポータルの行き先を引く関数を作る。ワールドは 1 回だけ引く（部屋に同じポータルがいくつあっても、描き直しても）。
 * 引けなかったワールドも覚える（無いワールドを何度も問い合わせない。部屋を入り直せば引き直す）。
 * ワールドへのポータルはプライベートのワールドを、部屋へのポータルは見る人が入れない部屋（公開範囲・招待・満員）を
 * locked にする。部屋に入れるかは人数で変わるので ROOM_STATUS_TTL_MS を過ぎたら引き直す（引いている途中は同じ
 * 問い合わせにまとめる。応答が無ければ timeoutMs で諦める）。無くなった部屋は null。一時的に引けなかったときは
 * 前の結果のまま、前の結果も無ければ UNKNOWN_ROOM（鍵は出さない）。rooms が無ければ部屋は引かない。
 */
export function createPortalLookup(
    fetchWorld: (ref: string) => Promise<WorldLook>,
    rooms?: PortalRoomSource,
    options: { now?: () => number; timeoutMs?: number } = {},
): PortalLookup {
    const now = options.now ?? Date.now;
    const timeoutMs = options.timeoutMs ?? ROOM_STATUS_TIMEOUT_MS;
    const worlds = new Map<string, Promise<PortalDestination | null>>();
    const roomRequests = new Map<
        string,
        { startedAt: number; settled: boolean; pending: Promise<PortalDestination | null> }
    >();
    const lastRooms = new Map<string, PortalDestination | null>();

    const loadRoom = (source: PortalRoomSource, room: string): Promise<PortalDestination | null> =>
        withinTime((signal) => source.fetch(room, signal), timeoutMs)
            .then(
                (found): PortalDestination | null =>
                    found && {
                        ...destinationOf(found.world),
                        ...(roomRefusal(found, source.viewerId) ? { locked: true } : {}),
                    },
                () => (lastRooms.has(room) ? (lastRooms.get(room) ?? null) : UNKNOWN_ROOM),
            )
            .then((destination) => {
                if (destination !== UNKNOWN_ROOM) lastRooms.set(room, destination);
                return destination;
            });

    const lookupRoom = (source: PortalRoomSource, room: string): Promise<PortalDestination | null> => {
        const entry = roomRequests.get(room);
        if (entry && (!entry.settled || now() - entry.startedAt < ROOM_STATUS_TTL_MS)) return entry.pending;
        const startedAt = now();
        const pending = loadRoom(source, room);
        roomRequests.set(room, { startedAt, settled: false, pending });
        void pending.then(() => {
            if (roomRequests.get(room)?.pending === pending)
                roomRequests.set(room, { startedAt, settled: true, pending });
        });
        return pending;
    };

    return (goal) => {
        if (goal.kind === 'room') return rooms ? lookupRoom(rooms, goal.room) : Promise.resolve(null);
        const key = portalWorldRef(goal);
        const cached = worlds.get(key);
        if (cached) return cached;
        const pending = fetchWorld(key).then(
            (world): PortalDestination => ({
                ...destinationOf(world),
                ...(isPortalDestination(world) ? {} : { locked: true }),
            }),
            () => null,
        );
        worlds.set(key, pending);
        return pending;
    };
}
