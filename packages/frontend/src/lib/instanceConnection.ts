import { type InstanceGrant, InstanceJoinRejected, type ResolveInstance } from '@ubichill/react';
import { isJoinRejection } from '@/world';
import { API_BASE } from './api';

/** SNS backend でチケットを取る（入室の認可は backend が行う）。 */
export const resolveInstance: ResolveInstance = async (instanceId, signal) => {
    const response = await fetch(`${API_BASE}/api/v1/instances/${encodeURIComponent(instanceId)}/join`, {
        method: 'POST',
        credentials: 'include',
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        const message = data.error ?? 'インスタンスに参加できません';
        throw isJoinRejection(response.status) ? new InstanceJoinRejected(message) : new Error(message);
    }
    const grant = data as InstanceGrant;
    return { ...grant, url: new URL(grant.url, API_BASE).href };
};
