/** 通知の API（一覧・既読・SSE・運営のお知らせ）。 */
import {
    type AppNotification,
    type CreateAnnouncementRequest,
    type MarkReadRequest,
    type NotificationPage,
    type NotificationStreamEvent,
    NotificationStreamEventSchema,
} from '@ubichill/shared';
import { API_BASE } from './api';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${API_BASE}/api/v1/notifications${path}`, {
        credentials: 'include',
        cache: 'no-store',
        ...init,
        headers: { ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers },
    });
    if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `HTTP ${res.status}`);
    }
    return (await res.json()) as T;
}

export const fetchNotifications = (cursor?: string) =>
    request<NotificationPage>(cursor ? `?cursor=${encodeURIComponent(cursor)}` : '');

export const markNotificationsRead = async (body: MarkReadRequest) =>
    (await request<{ unreadCount: number }>('/read', { method: 'POST', body: JSON.stringify(body) })).unreadCount;

export const createAnnouncement = (body: CreateAnnouncementRequest) =>
    request<AppNotification>('/announcements', { method: 'POST', body: JSON.stringify(body) });

export const notificationStreamUrl = (): string => `${API_BASE}/api/v1/notifications/stream`;

const STREAM_EVENTS = ['notification', 'read', 'removed'] as const;

/** SSE の 1 つの出来事を読む（形が違えば捨てる）。 */
export function parseStreamEvent(data: string): NotificationStreamEvent | undefined {
    try {
        const parsed = NotificationStreamEventSchema.safeParse(JSON.parse(data));
        return parsed.success ? parsed.data : undefined;
    } catch {
        return undefined;
    }
}

/**
 * SSE に繋ぐ。EventSource は切れると自分で繋ぎ直し、そのたびに onOpen が呼ばれる（取りこぼしを一覧の取り直しで埋める）。
 * 認証の失敗などで繋ぎ直しを諦めたら onGiveUp。
 */
export function openNotificationStream(handlers: {
    onEvent: (event: NotificationStreamEvent) => void;
    onOpen: () => void;
    onGiveUp: () => void;
}): () => void {
    const source = new EventSource(notificationStreamUrl(), { withCredentials: true });
    const listener = (e: MessageEvent<string>) => {
        const event = parseStreamEvent(e.data);
        if (event) handlers.onEvent(event);
    };
    for (const name of STREAM_EVENTS) source.addEventListener(name, listener);
    source.onopen = handlers.onOpen;
    source.onerror = () => {
        if (source.readyState === EventSource.CLOSED) handlers.onGiveUp();
    };
    return () => source.close();
}
