import { recheckIfForbidden } from '../account/adminStatus';
import { API_BASE } from '../api';

/** 連合でフォローしているサーバー（ワールド一覧の「グローバル」に、そのサーバーの公開ワールドが出る）。 */
export interface FederationPeer {
    id: string;
    baseUrl: string;
    displayName: string | null;
    createdAt: string;
}

async function errorMessage(res: Response): Promise<string> {
    recheckIfForbidden(res);
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

// ── ほかのサーバーとの付き合い方（管理者） ──

export type DomainPolicy = 'allow' | 'limit' | 'block';

/** 知っているほかのサーバー（連絡がつくたびに自動で記録される）と配送の調子。 */
export interface FederationServer {
    domain: string;
    software: string | null;
    version: string | null;
    federationVersion: number | null;
    firstSeenAt: string;
    lastSeenAt: string;
    lastSuccessAt: string | null;
    failingSince: string | null;
    pausedUntil: string | null;
    policy: DomainPolicy;
}

export interface DomainPolicyRecord {
    domain: string;
    policy: Exclude<DomainPolicy, 'allow'>;
    reason: string | null;
    createdAt: string;
}

export async function fetchFederationServers(): Promise<FederationServer[]> {
    const res = await fetch(`${API_BASE}/api/v1/federation/servers`, { credentials: 'include', cache: 'no-store' });
    if (!res.ok) throw new Error(await errorMessage(res));
    return ((await res.json()) as { servers: FederationServer[] }).servers;
}

export async function fetchDomainPolicies(): Promise<DomainPolicyRecord[]> {
    const res = await fetch(`${API_BASE}/api/v1/federation/policies`, { credentials: 'include', cache: 'no-store' });
    if (!res.ok) throw new Error(await errorMessage(res));
    return ((await res.json()) as { policies: DomainPolicyRecord[] }).policies;
}

/** 付き合い方を決める（allow は決めた方針を消す）。 */
export async function setDomainPolicy(domain: string, policy: DomainPolicy): Promise<void> {
    const url = `${API_BASE}/api/v1/federation/policies/${encodeURIComponent(domain)}`;
    const res =
        policy === 'allow'
            ? await fetch(url, { method: 'DELETE', credentials: 'include' })
            : await fetch(url, {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  credentials: 'include',
                  body: JSON.stringify({ policy }),
              });
    if (!res.ok && !(policy === 'allow' && res.status === 404)) throw new Error(await errorMessage(res));
}
