import type { WorldListItem } from '@ubichill/shared';
import { API_BASE } from '@/lib/api';

async function errorMessage(res: Response): Promise<string> {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    return data.error ?? `HTTP ${res.status}`;
}

/** 自分のお気に入り（作者まで確認できたワールド）と、取得できない・公開ルール外のお気に入りの URL。 */
export async function fetchMyFavoriteWorlds(): Promise<{ worlds: WorldListItem[]; unavailable: string[] }> {
    const res = await fetch(`${API_BASE}/api/v1/users/me/favorites/worlds`, {
        credentials: 'include',
        cache: 'no-store',
    });
    if (!res.ok) throw new Error(await errorMessage(res));
    return (await res.json()) as { worlds: WorldListItem[]; unavailable: string[] };
}

/** ほかのユーザーのお気に入り（公開。作者まで確認できたワールドだけ）。 */
export async function fetchUserFavoriteWorlds(userId: string): Promise<WorldListItem[]> {
    const res = await fetch(`${API_BASE}/api/v1/users/${encodeURIComponent(userId)}/favorites`);
    if (!res.ok) throw new Error(await errorMessage(res));
    return ((await res.json()) as { worlds: WorldListItem[] }).worlds;
}
