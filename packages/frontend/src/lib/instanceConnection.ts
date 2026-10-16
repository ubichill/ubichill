import { type InstanceGrant, InstanceJoinRejected, type ResolveInstance } from '@ubichill/react';
import type { Instance, InstanceAPI } from '@ubichill/shared';
import { API_BASE } from './api';

/** ビルド時に指定すると、SNSセッションを使わず独立したGoサーバーへ接続する。 */
export const STANDALONE_RUNTIME: string = import.meta.env.VITE_INSTANCE_SERVER_URL ?? '';
export const STANDALONE_INSTANCE: string = import.meta.env.VITE_INSTANCE_ID ?? 'standalone';

type RuntimePresence = InstanceAPI['schemas']['RuntimePresence'];

/**
 * 単体モードの Go が返す在室情報を、画面が使う {@link Instance} に合わせる。
 * Go は作者・mod の情報を返さないので、作者は空（= 未検証として入室確認の対象）にする。
 */
export const presenceToInstance = (presence: RuntimePresence, runtimeUrl: string): Instance => ({
    id: presence.id,
    status: 'active',
    leaderId: '',
    createdAt: '',
    expiresAt: null,
    world: { id: presence.id, version: '1', displayName: presence.name, authorId: '', mods: [] },
    access: { type: 'public', tags: [], password: false },
    stats: { currentUsers: presence.memberIds.length, maxUsers: presence.maxUsers },
    connection: { url: `${runtimeUrl}/realtime/v1/ws`, namespace: '' },
});

/**
 * 作者を確認できないワールドへの入室を断ったときの行き先。
 * 単体モードの `/` は同じインスタンスへ戻されて確認が出続けるので、移動せずその場で止める。
 */
export type DeclinedEntryExit = { kind: 'navigate'; to: string } | { kind: 'stay'; message: string };

export const declinedEntryExit = (standalone: boolean): DeclinedEntryExit =>
    standalone
        ? { kind: 'stay', message: '作者を確認できないワールドのため、入室を取りやめました' }
        : { kind: 'navigate', to: '/' };

/** 4xx は認可・入力の問題で再試行しても変わらない。408/429 と 5xx は一時的な失敗として再接続に任せる。 */
export const isJoinRejection = (status: number): boolean =>
    status >= 400 && status < 500 && status !== 408 && status !== 429;

export const resolveInstance: ResolveInstance = async (instanceId, password, signal) => {
    const key = `ubichill:guest:${STANDALONE_RUNTIME}:${instanceId}`;
    const path = STANDALONE_RUNTIME
        ? `${STANDALONE_RUNTIME}/realtime/v1/instances/${encodeURIComponent(instanceId)}/guest`
        : `${API_BASE}/api/v1/instances/${encodeURIComponent(instanceId)}/join`;
    const response = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: STANDALONE_RUNTIME ? 'omit' : 'include',
        body: JSON.stringify(STANDALONE_RUNTIME ? { resumeToken: sessionStorage.getItem(key) ?? '' } : { password }),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        const message = data.error ?? 'インスタンスに参加できません';
        throw isJoinRejection(response.status) ? new InstanceJoinRejected(message) : new Error(message);
    }
    const grant = data as InstanceGrant;
    if (STANDALONE_RUNTIME) sessionStorage.setItem(key, grant.token);
    return { ...grant, url: new URL(grant.url, STANDALONE_RUNTIME || API_BASE).href };
};
