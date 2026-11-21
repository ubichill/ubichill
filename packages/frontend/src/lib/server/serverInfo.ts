import type { ServerOverview, WorldListItem } from '@ubichill/shared';
import { API_BASE } from '../api';
import { errorMessage } from '../apiError';

/** 紹介のページに出すサーバーの情報（ログインしなくても読める）。 */
export async function fetchServerOverview(): Promise<ServerOverview> {
    const res = await fetch(`${API_BASE}/api/v1/server`);
    if (!res.ok) throw new Error(await errorMessage(res));
    return (await res.json()) as ServerOverview;
}

/** 紹介のページに並べる、このサーバーのワールド（ログインしなくても読める）。 */
export async function fetchLocalWorlds(): Promise<WorldListItem[]> {
    const res = await fetch(`${API_BASE}/api/v1/worlds?scope=local`);
    if (!res.ok) throw new Error(await errorMessage(res));
    return ((await res.json()) as { worlds: WorldListItem[] }).worlds;
}
