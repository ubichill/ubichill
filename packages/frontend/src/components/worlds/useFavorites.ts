import { API_BASE } from '../../lib/api';
import { createFavoriteStore } from '../../lib/favorites/favoriteStore';

const send = (method: 'POST' | 'DELETE', worldRef: string) =>
    fetch(`${API_BASE}/api/v1/users/me/favorites`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ worldRef }),
    }).then((res) => {
        if (!res.ok) throw new Error('failed');
        return res;
    });

/** お気に入りのワールド（worldRef＝正規 URL の集合）。 */
const worlds = createFavoriteStore({
    load: async () => {
        const res = await fetch(`${API_BASE}/api/v1/users/me/favorites`, { credentials: 'include' });
        return res.ok ? ((await res.json()) as { worldRefs: string[] }).worldRefs : undefined;
    },
    // サーバーは共有 URL を正規化して保存するので、保存された形を返す
    add: async (worldRef) =>
        ((await (await send('POST', worldRef)).json().catch(() => ({}))) as { worldRef?: string }).worldRef,
    remove: async (worldRef) => {
        await send('DELETE', worldRef);
    },
});

/** ログアウトしたとき（次の人に前の人のお気に入りを使わない）。 */
export const resetFavorites = worlds.reset;

export function useFavorites() {
    return worlds.useStore();
}
