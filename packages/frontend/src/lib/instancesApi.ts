/**
 * ワールド/インスタンスの取得・作成 API。WorldPage/Lobby/WorldDetailModal/
 * InstanceDetailOverlay/useWorldEditorApi 等で同一の fetch 処理が個別に書かれ、
 * リクエスト形状やエラーメッセージが少しずつ食い違っていたため、単一の実装に集約する。
 * ここは純粋な fetch ラッパーのみで、React の状態は持たない（呼び出し側の hooks/component が持つ）。
 */
import type { CreateInstanceRequest, Instance, WorldListItem } from '@ubichill/shared';
import { API_BASE } from './api';

async function readErrorMessage(res: Response, fallback: string): Promise<string> {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    return data.error ?? fallback;
}

export async function fetchWorld(worldId: string): Promise<WorldListItem> {
    const res = await fetch(`${API_BASE}/api/v1/worlds/${worldId}`, { credentials: 'include' });
    if (!res.ok) throw new Error('World not found');
    return res.json() as Promise<WorldListItem>;
}

/** `worldId` 省略時は自インスタンス（アクセス可能な全て）を返す。 */
export async function fetchInstances(worldId?: string): Promise<Instance[]> {
    const query = worldId ? `?worldId=${encodeURIComponent(worldId)}` : '';
    const res = await fetch(`${API_BASE}/api/v1/instances${query}`, {
        credentials: 'include',
        cache: 'no-store',
    });
    if (!res.ok) throw new Error(await readErrorMessage(res, 'インスタンス一覧の取得に失敗しました'));
    const data = (await res.json()) as { instances?: Instance[] };
    return data.instances ?? [];
}

export async function fetchInstance(instanceId: string): Promise<Instance> {
    const res = await fetch(`${API_BASE}/api/v1/instances/${instanceId}`, { credentials: 'include' });
    if (!res.ok) throw new Error(await readErrorMessage(res, 'インスタンスが見つかりません'));
    return res.json() as Promise<Instance>;
}

/** `worldId` 文字列のみ、または access/settings を含む完全な {@link CreateInstanceRequest} を受け取る。 */
export async function createInstance(request: string | CreateInstanceRequest): Promise<Instance> {
    const body = typeof request === 'string' ? { worldId: request } : request;
    const res = await fetch(`${API_BASE}/api/v1/instances`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(await readErrorMessage(res, 'インスタンスの作成に失敗しました'));
    return res.json() as Promise<Instance>;
}
