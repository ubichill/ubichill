import type { PortalTarget } from '@ubichill/core-components';
import type { WorldListItem } from '@ubichill/shared';
import type { PortalDestination, PortalLookup } from '@/world';

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

/**
 * ポータルの行き先を引く関数を作る。同じ行き先は 1 回だけ引く（部屋に同じポータルがいくつあっても、描き直しても）。
 * 引けなかった行き先も覚える（無いワールドを何度も問い合わせない。部屋を入り直せば引き直す）。
 */
export function createPortalLookup(
    fetchWorld: (ref: string) => Promise<Pick<WorldListItem, 'displayName' | 'thumbnail'>>,
): PortalLookup {
    const cache = new Map<string, Promise<PortalDestination | null>>();
    return (target) => {
        const ref = portalWorldRef(target);
        const cached = cache.get(ref);
        if (cached) return cached;
        const pending = fetchWorld(ref).then(
            (world): PortalDestination => ({
                name: world.displayName,
                ...(world.thumbnail ? { thumbnail: world.thumbnail } : {}),
            }),
            () => null,
        );
        cache.set(ref, pending);
        return pending;
    };
}
