import type { FavoritesVisibility, WorldListItem } from '@ubichill/shared';
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

export type UserFavorites =
    | { status: 'visible'; worlds: WorldListItem[]; visibility: FavoritesVisibility }
    /** 公開範囲により、閲覧者には見せない（中身も件数も返らない）。 */
    | { status: 'hidden' };

/** ユーザーのお気に入り。公開範囲に従い、見てよい人にだけ返る（作者まで確認できたワールドだけ）。 */
export async function fetchUserFavorites(userId: string): Promise<UserFavorites> {
    const res = await fetch(`${API_BASE}/api/v1/users/${encodeURIComponent(userId)}/favorites`, {
        credentials: 'include',
    });
    if (res.status === 403) return { status: 'hidden' };
    if (!res.ok) throw new Error(await errorMessage(res));
    const data = (await res.json()) as { worlds: WorldListItem[]; visibility: FavoritesVisibility };
    return { status: 'visible', worlds: data.worlds, visibility: data.visibility };
}
