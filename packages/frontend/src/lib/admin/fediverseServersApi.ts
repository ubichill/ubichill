import { recheckIfForbidden } from '../account/adminStatus';
import { API_BASE } from '../api';
import { errorMessage } from '../apiError';

const BASE = `${API_BASE}/api/v1/admin/fediverse-servers`;

/** ログイン画面に並べるサーバー（コントロールパネルの「認証」）。どの操作も変えた後の一覧を返す。 */
async function request(path: string, init: RequestInit = {}): Promise<string[]> {
    const res = await fetch(`${BASE}${path}`, {
        credentials: 'include',
        cache: 'no-store',
        ...init,
        headers: init.body ? { 'Content-Type': 'application/json' } : undefined,
    });
    if (!res.ok) {
        recheckIfForbidden(res);
        throw new Error(await errorMessage(res));
    }
    return ((await res.json()) as { servers: string[] }).servers;
}

export const fetchFeaturedServers = (): Promise<string[]> => request('');

export const addFeaturedServer = (server: string): Promise<string[]> =>
    request('', { method: 'POST', body: JSON.stringify({ server }) });

export const removeFeaturedServer = (host: string): Promise<string[]> =>
    request(`/${encodeURIComponent(host)}`, { method: 'DELETE' });

export const reorderFeaturedServers = (servers: readonly string[]): Promise<string[]> =>
    request('/order', { method: 'PUT', body: JSON.stringify({ servers }) });
