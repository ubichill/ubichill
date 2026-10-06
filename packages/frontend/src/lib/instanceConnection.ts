import type { InstanceGrant, ResolveInstance } from '@ubichill/react';
import { API_BASE } from './api';

/** ビルド時に指定すると、SNSセッションを使わず独立したGoサーバーへ接続する。 */
export const STANDALONE_RUNTIME: string = import.meta.env.VITE_INSTANCE_SERVER_URL ?? '';
export const STANDALONE_INSTANCE: string = import.meta.env.VITE_INSTANCE_ID ?? 'standalone';

export const resolveInstance: ResolveInstance = async (instanceId, password) => {
    const key = `ubichill:guest:${STANDALONE_RUNTIME}:${instanceId}`;
    const path = STANDALONE_RUNTIME
        ? `${STANDALONE_RUNTIME}/realtime/v1/instances/${encodeURIComponent(instanceId)}/guest`
        : `${API_BASE}/api/v1/instances/${encodeURIComponent(instanceId)}/join`;
    const response = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: STANDALONE_RUNTIME ? 'omit' : 'include',
        body: JSON.stringify(STANDALONE_RUNTIME ? { resumeToken: sessionStorage.getItem(key) ?? '' } : { password }),
        signal: AbortSignal.timeout(10000),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? 'インスタンスに参加できません');
    const grant = data as InstanceGrant;
    if (STANDALONE_RUNTIME) sessionStorage.setItem(key, grant.token);
    return { ...grant, url: new URL(grant.url, STANDALONE_RUNTIME || API_BASE).href };
};
