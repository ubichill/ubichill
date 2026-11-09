/**
 * Go のインスタンスサーバーに直接入るための API（`world.html`）。
 * ゲストの入室（`POST /realtime/v1/instances/:id/guest`）と在席の取得だけで、SNS backend は通らない。
 */
import { type InstanceGrant, InstanceJoinRejected, type ResolveInstance } from '@ubichill/react';
import type { Instance, InstanceAPI } from '@ubichill/shared';
import { InstanceNotFoundError } from './instanceFailure';

type RuntimePresence = InstanceAPI['schemas']['RuntimePresence'];

/** 4xx は認可・入力の問題で再試行しても変わらない。408/429 と 5xx は一時的な失敗として再接続に任せる。 */
export const isJoinRejection = (status: number): boolean =>
    status >= 400 && status < 500 && status !== 408 && status !== 429;

/**
 * Go が返す在室情報を、画面が使う {@link Instance} に合わせる。
 * Go は作者・mod の情報を返さないので、作者は空（= 未検証として入室確認の対象）にする。
 * `runtimeOrigin` は Go のオリジン（同じオリジンなら空文字）。
 */
export const presenceToInstance = (presence: RuntimePresence, runtimeOrigin = ''): Instance => ({
    id: presence.id,
    status: 'active',
    leaderId: '',
    createdAt: '',
    expiresAt: null,
    world: { id: presence.id, version: '1', displayName: presence.name, authorId: '', mods: [] },
    access: { type: 'public', tags: [] },
    stats: { currentUsers: presence.memberIds.length, maxUsers: presence.maxUsers },
    connection: { url: `${runtimeOrigin}/realtime/v1/ws`, namespace: '' },
});

export interface GuestTokenStore {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
}

/**
 * ゲストとして入る接続先の解決。発行されたチケットを resumeToken として保存し、
 * 同じタブの再接続では同じゲスト ID を引き継ぐ。
 */
export function createGuestResolver(runtimeOrigin: string, store: GuestTokenStore): ResolveInstance {
    return async (instanceId, signal) => {
        const key = `ubichill:guest:${runtimeOrigin}:${instanceId}`;
        const response = await fetch(`${runtimeOrigin}/realtime/v1/instances/${encodeURIComponent(instanceId)}/guest`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'omit',
            body: JSON.stringify({ resumeToken: store.getItem(key) ?? '' }),
            signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000),
        });
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        if (!response.ok) {
            const message = data.error ?? 'インスタンスに参加できません';
            throw isJoinRejection(response.status) ? new InstanceJoinRejected(message) : new Error(message);
        }
        const grant = data as unknown as InstanceGrant;
        store.setItem(key, grant.token);
        return { ...grant, url: `${runtimeOrigin}${grant.url.startsWith('/') ? grant.url : `/${grant.url}`}` };
    };
}

/** Go の在席から {@link Instance} を作る。部屋が無ければ throw。 */
export async function fetchGuestInstance(runtimeOrigin: string, instanceId: string): Promise<Instance> {
    const response = await fetch(`${runtimeOrigin}/realtime/v1/instances/${encodeURIComponent(instanceId)}`, {
        credentials: 'omit',
    });
    if (response.status === 404) throw new InstanceNotFoundError('インスタンスが見つかりません');
    if (!response.ok) throw new Error('インスタンスが見つかりません');
    return presenceToInstance((await response.json()) as RuntimePresence, runtimeOrigin);
}
