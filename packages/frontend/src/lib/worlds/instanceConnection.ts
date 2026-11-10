import { type InstanceGrant, InstanceJoinRejected, type ResolveInstance } from '@ubichill/react';
import { isJoinRejection } from '@/world';
import { API_BASE } from '../api';
import { viaOf } from './joinVia';

/** SNS backend でチケットを取る（入室の認可は backend が行う）。 */
export const resolveInstance: ResolveInstance = async (instanceId, signal) => {
    const via = viaOf(instanceId);
    const response = await fetch(`${API_BASE}/api/v1/instances/${encodeURIComponent(instanceId)}/join`, {
        method: 'POST',
        credentials: 'include',
        // 会いに行くフレンド（ほかのサーバーの部屋で、部屋のサーバーがその人との関係から確かめる）
        ...(via.length > 0 ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ via }) } : {}),
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
