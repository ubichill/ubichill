import type { ExternalWork, ExternalWorkStatus, PublishedMod } from '@ubichill/shared';
import { API_BASE } from './api';

/** 登録した外部の作品（本人）。`refresh` なら公開先を確かめ直す（再確認）。 */
export async function fetchMyExternalWorks(refresh = false): Promise<ExternalWork[]> {
    const res = await fetch(`${API_BASE}/api/v1/users/me/external-works${refresh ? '?refresh=1' : ''}`, {
        credentials: 'include',
        cache: 'no-store',
    });
    if (res.status === 429) throw new Error('再確認が多すぎます。少し待ってから試してください');
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

/** 確かめた状態の表示（純粋）。published 以外はユーザーページに出ない。 */
export function describeExternalWorkStatus(status: ExternalWorkStatus): { label: string; hint: string; ok: boolean } {
    switch (status) {
        case 'published':
            return { label: '公開済み', hint: 'ユーザーページに出ています', ok: true };
        case 'not-found':
            return {
                label: '公開待ち',
                hint: '公開先に見つかりません。公開したばかりなら、少し待って再確認してください',
                ok: false,
            };
        case 'unreachable':
            return { label: '取得失敗', hint: '公開先に届きません。時間をおいて再確認してください', ok: false };
        case 'invalid':
            return {
                label: '署名を確認できません',
                hint: '公開先の内容があなたの署名と合いません（書き換え・鍵の取り消し・名前の変更）。公開し直してください',
                ok: false,
            };
    }
}
