/**
 * お気に入りの mod（手元に持っておく mod）。鍵は作者参照（`@作者@サーバー/ID`）。
 * お気に入り済みの印は共有ストア、mod 管理の「お気に入り」タブの一覧はサーバーが作者のカタログで引いた今の版。
 */
import { type FavoriteMods, formatPackageRef, type ModFavoriteRef, parsePackageRef } from '@ubichill/shared';
import { API_BASE } from '../api';
import { errorMessage } from '../apiError';
import { createFavoriteStore } from '../favorites/favoriteStore';
import { useResolvedFavorites } from '../favorites/useResolvedFavorites';
import { pushToast } from '../toast';

export const modFavoriteKey = (mod: ModFavoriteRef): string => formatPackageRef({ author: mod.author, id: mod.id });

const send = async (method: 'POST' | 'DELETE', key: string): Promise<void> => {
    const ref = parsePackageRef(key);
    if (!ref) throw new Error('mod を読めません');
    const res = await fetch(`${API_BASE}/api/v1/users/me/favorites/mods`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ author: ref.author, id: ref.id }),
    });
    if (!res.ok) throw new Error(await errorMessage(res));
};

const store = createFavoriteStore({
    load: async () => {
        const res = await fetch(`${API_BASE}/api/v1/users/me/favorites`, { credentials: 'include' });
        if (!res.ok) return undefined;
        return (((await res.json()) as { modRefs?: ModFavoriteRef[] }).modRefs ?? []).map(modFavoriteKey);
    },
    add: async (key) => {
        await send('POST', key);
        return undefined;
    },
    remove: (key) => send('DELETE', key),
    onError: (error, adding) =>
        pushToast(
            error instanceof Error && error.message
                ? error.message
                : adding
                  ? 'お気に入りに追加できませんでした'
                  : 'お気に入りから外せませんでした',
            'error',
        ),
});

/** ログアウトしたとき（次の人に前の人のお気に入りを使わない）。 */
export const resetModFavorites = store.reset;

export function useModFavorites() {
    return store.useStore();
}

export async function fetchMyFavoriteMods(): Promise<FavoriteMods> {
    const res = await fetch(`${API_BASE}/api/v1/users/me/favorites/mods`, {
        credentials: 'include',
        cache: 'no-store',
    });
    if (!res.ok) throw new Error(await errorMessage(res));
    return (await res.json()) as FavoriteMods;
}

/** 読み込み済みの結果から、いまもお気に入りのものだけを表示する（外した分は取り直さずに消す）。 */
export function visibleFavoriteMods(loaded: FavoriteMods, favorites: ReadonlySet<string>): FavoriteMods {
    return {
        mods: loaded.mods.filter((mod) => favorites.has(modFavoriteKey(mod))),
        unavailable: loaded.unavailable.filter((ref) => favorites.has(modFavoriteKey(ref))),
    };
}

const EMPTY: FavoriteMods = { mods: [], unavailable: [] };

/** mod 管理の「お気に入り」タブの一覧（enabled のときだけ読む）。 */
export function useFavoriteMods(enabled: boolean) {
    const { favorites } = useModFavorites();
    const { view, ...state } = useResolvedFavorites({
        enabled,
        favorites,
        fetchResolved: fetchMyFavoriteMods,
        visible: visibleFavoriteMods,
        empty: EMPTY,
        failure: 'お気に入りの mod を取得できませんでした',
    });
    return { ...view, ...state };
}
