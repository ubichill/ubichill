import type { HomeInstanceResponse, HomeSettingsUpdate, HomeView } from '@ubichill/shared';
import { API_BASE } from '@/lib/api';

async function errorMessage(res: Response): Promise<string> {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    return data.error ?? `HTTP ${res.status}`;
}

/** 自分のホームの設定とホームのワールド。 */
export async function fetchHome(): Promise<HomeView> {
    const res = await fetch(`${API_BASE}/api/v1/users/me/home`, { credentials: 'include', cache: 'no-store' });
    if (!res.ok) throw new Error(await errorMessage(res));
    return (await res.json()) as HomeView;
}

/** ホームのワールド（null で既定に戻す）・公開範囲を変える。 */
export async function updateHome(update: HomeSettingsUpdate): Promise<HomeView> {
    const res = await fetch(`${API_BASE}/api/v1/users/me/home`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(update),
    });
    if (!res.ok) throw new Error(await errorMessage(res));
    return (await res.json()) as HomeView;
}

/** ホームの部屋（あれば使い回し、無ければ作る）。useDefault なら設定を無視して既定のワールド。 */
export async function ensureHomeInstance(options: { useDefault?: boolean } = {}): Promise<HomeInstanceResponse> {
    const query = options.useDefault ? '?fallback=default' : '';
    const res = await fetch(`${API_BASE}/api/v1/users/me/home/instance${query}`, {
        method: 'POST',
        credentials: 'include',
    });
    if (!res.ok) throw new Error(await errorMessage(res));
    return (await res.json()) as HomeInstanceResponse;
}
