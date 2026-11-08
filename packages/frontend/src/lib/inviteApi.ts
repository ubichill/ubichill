/** 招待とリクエストインバイトの API（規則は shared の instanceAccess.ts）。 */
import type {
    InviteCandidatesResponse,
    InviteRequestResponse,
    SendInvitesRequest,
    SendInvitesResponse,
} from '@ubichill/shared';
import { API_BASE } from './api';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${API_BASE}/api/v1${path}`, {
        credentials: 'include',
        cache: 'no-store',
        ...init,
        headers: { ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers },
    });
    if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `HTTP ${res.status}`);
    }
    return (res.status === 204 ? undefined : await res.json()) as T;
}

const room = (instanceId: string) => `/instances/${encodeURIComponent(instanceId)}`;

export const fetchInviteCandidates = (instanceId: string) =>
    request<InviteCandidatesResponse>(`${room(instanceId)}/invite-candidates`);

export const sendInvites = (instanceId: string, body: SendInvitesRequest) =>
    request<SendInvitesResponse>(`${room(instanceId)}/invites`, { method: 'POST', body: JSON.stringify(body) });

export const requestInvite = (userId: string) =>
    request<InviteRequestResponse>('/social/invite-requests', { method: 'POST', body: JSON.stringify({ userId }) });

export const acceptInviteRequest = (userId: string) =>
    request<void>(`/social/invite-requests/${encodeURIComponent(userId)}/accept`, { method: 'POST' });

export const declineInviteRequest = (userId: string) =>
    request<void>(`/social/invite-requests/${encodeURIComponent(userId)}`, { method: 'DELETE' });
