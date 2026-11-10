/** フレンド同士のメッセージの API（会話の一覧・会話・送る・既読・リアクション）。 */
import type {
    ConversationPage,
    ConversationsResponse,
    DirectMessage,
    MessageReactionsResponse,
} from '@ubichill/shared';
import { API_BASE } from '../api';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${API_BASE}/api/v1/messages${path}`, {
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

const userPath = (userId: string) => `/${encodeURIComponent(userId)}`;

export const fetchConversations = async () => (await request<ConversationsResponse>('')).conversations;

export const fetchConversation = (userId: string, cursor?: string) =>
    request<ConversationPage>(`${userPath(userId)}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`);

export const sendMessage = (userId: string, content: string) =>
    request<DirectMessage>(userPath(userId), { method: 'POST', body: JSON.stringify({ content }) });

export const markConversationRead = (userId: string) => request<void>(`${userPath(userId)}/read`, { method: 'POST' });

/** messageId のリアクションを emoji にする（null なら外す）。その 1 通のリアクションの全部が返る。 */
export const setReaction = (userId: string, messageId: string, emoji: string | null) =>
    request<MessageReactionsResponse>(`${userPath(userId)}/${encodeURIComponent(messageId)}/reaction`, {
        method: emoji ? 'PUT' : 'DELETE',
        ...(emoji ? { body: JSON.stringify({ emoji }) } : {}),
    });
