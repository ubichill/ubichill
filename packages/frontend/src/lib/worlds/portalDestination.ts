import type { PortalTarget } from '@ubichill/core-components';
import { type Instance, isFullFor, isPortalDestination, type WorldListItem } from '@ubichill/shared';
import type { PortalDestination, PortalGoal, PortalLookup } from '@/world';

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

/** 部屋へのポータルの行き先を引く手段。部屋の詳細（見る人に見えなければ失敗する）と、満員の判定に使う見る人。 */
export interface PortalRoomSource {
    fetch: (address: string) => Promise<Pick<Instance, 'canJoin' | 'leaderId' | 'stats'> & { world: WorldLook }>;
    viewerId: string | null;
}

/**
 * ポータルの行き先を引く関数を作る。同じ行き先は 1 回だけ引く（部屋に同じポータルがいくつあっても、描き直しても）。
 * 引けなかった行き先も覚える（無いワールドを何度も問い合わせない。部屋を入り直せば引き直す）。
 * 部屋へのポータルは、見る人が入れない部屋（公開範囲・招待・満員）を、ワールドへのポータルはプライベートのワールドを
 * locked にする。rooms が無ければ部屋は引かない。
 */
export function createPortalLookup(
    fetchWorld: (ref: string) => Promise<WorldLook>,
    rooms?: PortalRoomSource,
): PortalLookup {
    const cache = new Map<string, Promise<PortalDestination | null>>();
    const load = (goal: PortalGoal): Promise<PortalDestination | null> => {
        if (goal.kind !== 'room') {
            return fetchWorld(portalWorldRef(goal)).then(
                (world): PortalDestination => ({
                    ...destinationOf(world),
                    ...(isPortalDestination(world) ? {} : { locked: true }),
                }),
                () => null,
            );
        }
        if (!rooms) return Promise.resolve(null);
        return rooms.fetch(goal.room).then(
            (room): PortalDestination => {
                const locked = room.canJoin === false || isFullFor(room, rooms.viewerId);
                return { ...destinationOf(room.world), ...(locked ? { locked } : {}) };
            },
            () => null,
        );
    };
    return (goal) => {
        const key = goal.kind === 'room' ? `room:${goal.room}` : portalWorldRef(goal);
        const cached = cache.get(key);
        if (cached) return cached;
        const pending = load(goal);
        cache.set(key, pending);
        return pending;
    };
}
