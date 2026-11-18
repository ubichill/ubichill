/** 招待とリクエストインバイトの API（規則は shared の instanceAccess.ts）。 */
import type {
    InviteCandidatesResponse,
    InviteRequestResponse,
    SendInvitesRequest,
    SendInvitesResponse,
} from '@ubichill/shared';
import { requestApi } from '../api';

const room = (instanceId: string) => `/instances/${encodeURIComponent(instanceId)}`;

export const fetchInviteCandidates = (instanceId: string) =>
    requestApi<InviteCandidatesResponse>(`${room(instanceId)}/invite-candidates`);

export const sendInvites = (instanceId: string, body: SendInvitesRequest) =>
    requestApi<SendInvitesResponse>(`${room(instanceId)}/invites`, { method: 'POST', body: JSON.stringify(body) });

export const requestInvite = (userId: string) =>
    requestApi<InviteRequestResponse>('/social/invite-requests', { method: 'POST', body: JSON.stringify({ userId }) });

export const acceptInviteRequest = (userId: string) =>
    requestApi<void>(`/social/invite-requests/${encodeURIComponent(userId)}/accept`, { method: 'POST' });

export const declineInviteRequest = (userId: string) =>
    requestApi<void>(`/social/invite-requests/${encodeURIComponent(userId)}`, { method: 'DELETE' });
