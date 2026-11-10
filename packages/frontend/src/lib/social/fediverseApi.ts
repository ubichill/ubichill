import type { FediverseOverview, FediverseSettings, FediverseSettingsUpdate } from '@ubichill/shared';
import { API_BASE } from '@/lib/api';

async function errorMessage(res: Response): Promise<string> {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    return data.error ?? `HTTP ${res.status}`;
}

/** 自分のフェディバースのアカウント・設定・承認待ち・フォロワー。 */
export async function fetchFediverse(): Promise<FediverseOverview> {
    const res = await fetch(`${API_BASE}/api/v1/fediverse`, { credentials: 'include', cache: 'no-store' });
    if (!res.ok) throw new Error(await errorMessage(res));
    return (await res.json()) as FediverseOverview;
}

/** 承認制・検索に出すかを変える（承認制をやめると、承認待ちはまとめて承認される）。 */
export async function updateFediverseSettings(update: FediverseSettingsUpdate): Promise<FediverseSettings> {
    const res = await fetch(`${API_BASE}/api/v1/fediverse/settings`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(update),
    });
    if (!res.ok) throw new Error(await errorMessage(res));
    return (await res.json()) as FediverseSettings;
}

/** 承認待ちを承認する（approve）・断る / フォロワーから外す（reject）。 */
export async function answerFollower(actorId: string, action: 'approve' | 'reject'): Promise<void> {
    const res = await fetch(`${API_BASE}/api/v1/fediverse/followers/${action}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actorId }),
    });
    if (!res.ok) throw new Error(await errorMessage(res));
}
