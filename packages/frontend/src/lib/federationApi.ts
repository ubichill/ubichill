import { API_BASE } from '@/lib/api';

/** 連合でフォローしているサーバー（ワールド一覧の「グローバル」に、そのサーバーの公開ワールドが出る）。 */
export interface FederationPeer {
    id: string;
    baseUrl: string;
    displayName: string | null;
    createdAt: string;
}

async function errorMessage(res: Response): Promise<string> {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    return data.error ?? `HTTP ${res.status}`;
}

export async function fetchPeers(): Promise<FederationPeer[]> {
    const res = await fetch(`${API_BASE}/api/v1/federation/peers`, { credentials: 'include', cache: 'no-store' });
    if (!res.ok) throw new Error(await errorMessage(res));
    return ((await res.json()) as { peers: FederationPeer[] }).peers;
}

export async function followPeer(baseUrl: string): Promise<FederationPeer> {
    const res = await fetch(`${API_BASE}/api/v1/federation/peers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ baseUrl }),
    });
    if (!res.ok) throw new Error(await errorMessage(res));
    return (await res.json()) as FederationPeer;
}

export async function unfollowPeer(id: string): Promise<void> {
    const res = await fetch(`${API_BASE}/api/v1/federation/peers/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        credentials: 'include',
    });
    if (!res.ok) throw new Error(await errorMessage(res));
}
