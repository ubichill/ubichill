import type { WorldListItem } from '@ubichill/shared';
import { useEffect, useState } from 'react';
import { fetchWorld } from '@/lib/worlds/instancesApi';
import { needsSharePathLookup, worldPagePath } from '@/lib/worlds/worldRef';

/** URL ごとに一度だけ問い合わせる（詳細を開くたびに外部のワールドを取り直さない）。 */
const lookups = new Map<string, Promise<string | undefined>>();

const lookupSharePath = (url: string): Promise<string | undefined> => {
    const hit = lookups.get(url);
    if (hit) return hit;
    const pending = fetchWorld(url).then(
        (world) => world.sharePath,
        () => undefined,
    );
    lookups.set(url, pending);
    return pending;
};

/**
 * ワールドの共有ページのパス。一覧から来て短い共有ページを知らない外部のワールドは、作者を確かめられていれば
 * 問い合わせて `/@handle/name` に差し替える（それまでは `/world?url=…`）。
 */
export function useWorldPagePath(world: Partial<WorldListItem> & { id: string }): string {
    const fallback = worldPagePath(world);
    const [found, setFound] = useState<{ url: string; path: string } | null>(null);
    const url = world.url ?? world.source?.url;
    const lookup = needsSharePathLookup({ ...world, url }) ? url : undefined;

    useEffect(() => {
        if (!lookup) return;
        const ctrl = { cancelled: false };
        void lookupSharePath(lookup).then((path) => {
            if (!ctrl.cancelled && path) setFound({ url: lookup, path });
        });
        return () => {
            ctrl.cancelled = true;
        };
    }, [lookup]);

    return found && found.url === lookup ? found.path : fallback;
}
