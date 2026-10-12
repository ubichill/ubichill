import type { ExternalWork, PublishedMod } from '@ubichill/shared';
import { API_BASE } from './api';

/** 登録した外部の作品（本人）。 */
export async function fetchMyExternalWorks(): Promise<ExternalWork[]> {
    const res = await fetch(`${API_BASE}/api/v1/users/me/external-works`, {
        credentials: 'include',
        cache: 'no-store',
    });
    if (!res.ok) throw new Error(`外部の作品を読み込めません (${res.status})`);
    return ((await res.json()) as { works: ExternalWork[] }).works;
}

export async function removeMyExternalWork(work: Pick<ExternalWork, 'kind' | 'url' | 'name'>): Promise<void> {
    const res = await fetch(`${API_BASE}/api/v1/users/me/external-works`, {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: work.kind, url: work.url, name: work.name }),
    });
    if (!res.ok && res.status !== 404) throw new Error(`消せませんでした (${res.status})`);
}

/** ユーザーが公開している mod（いま本人の署名付きで配られていると確かめられたもの）。 */
export async function fetchPublishedMods(userId: string): Promise<PublishedMod[]> {
    const res = await fetch(`${API_BASE}/api/v1/users/${encodeURIComponent(userId)}/mods`, { credentials: 'include' });
    if (!res.ok) return [];
    return ((await res.json()) as { mods: PublishedMod[] }).mods;
}
