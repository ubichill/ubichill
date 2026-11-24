/**
 * お気に入りの mod の実体（DB・カタログ・ほかのサーバーへの取得・キャッシュ）。手順は modFavorites.ts、引き方は modLookup.ts。
 * 公開範囲はワールドのお気に入りと同じ 1 つの設定（favoriteService.visibleTo が判定してから visible を呼ぶ）。
 */
import { modFavoriteRepository } from '@ubichill/db';
import type { ModFavoriteRef, PackageDescriptor } from '@ubichill/shared';
import { safeFetch } from '../../lib/safeFetch';
import { createTtlCache } from '../../utils/ttlCache';
import { selfDomain } from '../authors/authorKeys';
import { backendEvents } from '../cluster/backendEvents';
import { modDescriptor } from './catalog';
import { createModFavorites } from './modFavorites';
import { createModLookup, type ModLookup } from './modLookup';

const lookupMod = createModLookup({
    selfDomain,
    localDescriptor: modDescriptor,
    fetchJson: async (url) => {
        const res = await safeFetch(url, {
            headers: { Accept: 'application/jrd+json, application/json' },
            signal: AbortSignal.timeout(5000),
            maxBytes: 64 * 1024,
        });
        if (!res.ok) return { status: res.status, body: undefined };
        return { status: res.status, body: await res.json().catch(() => undefined) };
    },
});

class LookupMiss extends Error {
    constructor(readonly result: ModLookup) {
        super(result.status);
    }
}

// 引けた mod はカタログと同じ 5 分、無い・届かない mod は 1 分覚える（届かない作者へ一覧のたびに取りに行かない）
const lookups = createTtlCache<ModLookup>({ ttlMs: 5 * 60 * 1000, max: 2000 });
const recent = createTtlCache<ModLookup>({ ttlMs: 60 * 1000, max: 2000 });
const lookup = (ref: ModFavoriteRef): Promise<ModLookup> => {
    const key = `@${ref.author}/${ref.id}`;
    return lookups
        .getOrCreate(key, async () => {
            const found = await recent.getOrCreate(key, () => lookupMod(ref));
            if (found.status !== 'found') throw new LookupMiss(found);
            return found;
        })
        .catch((e: unknown): ModLookup => (e instanceof LookupMiss ? e.result : { status: 'unreachable' }));
};

// ほかの人に見せる一覧は、ワールドのお気に入りと同じくユーザーごとに数分覚える（変わったら捨てる）
const visibleCache = createTtlCache<PackageDescriptor[]>({ ttlMs: 3 * 60 * 1000, max: 500 });
backendEvents.on('favorites.changed', ({ userId }) => visibleCache.delete(userId));

const favorites = createModFavorites({
    list: (userId) => modFavoriteRepository.list(userId),
    addWithinLimit: (userId, ref, max) => modFavoriteRepository.addWithinLimit(userId, ref, max),
    remove: (userId, ref) => modFavoriteRepository.remove(userId, ref),
    lookup,
    changed: (userId) => {
        visibleCache.delete(userId);
        backendEvents.broadcast({ type: 'favorites.changed', userId });
    },
});

export const modFavoriteService = {
    refs: favorites.refs,
    resolved: favorites.resolved,
    add: favorites.add,
    remove: favorites.remove,
    visible: (userId: string) => visibleCache.getOrCreate(userId, () => favorites.visible(userId)),
};
