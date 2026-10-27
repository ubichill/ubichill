import type { AppNotification } from '@ubichill/shared';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
    EMPTY_FEED,
    type FeedState,
    markReadLocally,
    type ReadTarget,
    undoMarkRead,
    withFirstPage,
    withNextPage,
    withStreamEvent,
    withUnreadCount,
} from '@/lib/notificationFeed';
import { groupNotifications, notificationText } from '@/lib/notifications';
import { fetchNotifications, markNotificationsRead, openNotificationStream } from '@/lib/notificationsApi';
import { useSession } from '@/lib/session';
import { fetchFriends } from '@/lib/socialApi';
import { pushToast } from '@/lib/toast';

/** SSE が使えないとき（繋ぎ直しを諦めた）の取り直しの間隔。 */
const FALLBACK_POLL_MS = 60_000;

function useNotificationFeed(enabled: boolean) {
    const [feed, setFeed] = useState<FeedState>(EMPTY_FEED);
    const [incomingIds, setIncomingIds] = useState<ReadonlySet<string>>(new Set());
    const [error, setError] = useState<string | null>(null);
    const loadingMore = useRef(false);

    const refreshFriends = useCallback(async () => {
        const friends = await fetchFriends().catch(() => undefined);
        if (friends) setIncomingIds(new Set(friends.incoming.map((u) => u.id)));
    }, []);

    const reload = useCallback(async () => {
        try {
            const page = await fetchNotifications();
            setFeed((s) => withFirstPage(s, page));
            setError(null);
        } catch (e) {
            setError(e instanceof Error ? e.message : '通知を読み込めません');
        }
        await refreshFriends();
    }, [refreshFriends]);

    useEffect(() => {
        if (!enabled) {
            setFeed(EMPTY_FEED);
            return;
        }
        const state = { poll: undefined as ReturnType<typeof setInterval> | undefined };
        void reload();
        const close = openNotificationStream({
            onOpen: () => void reload(),
            onGiveUp: () => {
                state.poll ??= setInterval(() => void reload(), FALLBACK_POLL_MS);
            },
            onEvent: (event) => {
                setFeed((s) => withStreamEvent(s, event));
                if (event.type === 'notification' && !event.notification.read) {
                    pushToast(notificationText(event.notification));
                    if (event.notification.type === 'Follow') void refreshFriends();
                }
            },
        });
        const onFocus = () => void reload();
        window.addEventListener('focus', onFocus);
        return () => {
            close();
            clearInterval(state.poll);
            window.removeEventListener('focus', onFocus);
        };
    }, [enabled, reload, refreshFriends]);

    const loadMore = useCallback(async () => {
        if (!feed.nextCursor || loadingMore.current) return;
        loadingMore.current = true;
        try {
            const page = await fetchNotifications(feed.nextCursor);
            setFeed((s) => withNextPage(s, page));
        } catch (e) {
            setError(e instanceof Error ? e.message : '通知を読み込めません');
        } finally {
            loadingMore.current = false;
        }
    }, [feed.nextCursor]);

    const markRead = useCallback(async (target: ReadTarget) => {
        // undo は楽観的な更新と同じ状態から作る（setState の関数の中で計算して取り出す）
        const holder: { undo?: ReturnType<typeof markReadLocally>['undo'] } = {};
        setFeed((s) => {
            const result = markReadLocally(s, target);
            holder.undo = result.undo;
            return result.state;
        });
        try {
            const unread = await markNotificationsRead('all' in target ? { all: true } : { ids: [...target.ids] });
            setFeed((s) => withUnreadCount(s, unread));
        } catch (e) {
            const undo = holder.undo;
            if (undo) setFeed((s) => undoMarkRead(s, undo));
            setError(e instanceof Error ? e.message : '既読にできませんでした');
        }
    }, []);

    const groups = useMemo(() => groupNotifications(feed.items), [feed.items]);
    return { feed, groups, error, incomingIds, reload, loadMore, markRead, refreshFriends };
}

export type NotificationsState = ReturnType<typeof useNotificationFeed>;

const NotificationsContext = createContext<NotificationsState | null>(null);

/** ログインしている間だけ、通知の一覧と SSE をアプリ全体で 1 つ持つ（タブの開閉で繋ぎ直さない）。 */
export function NotificationsProvider({ children }: { children: ReactNode }) {
    const { data } = useSession();
    const value = useNotificationFeed(!!data?.user);
    return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}

export function useNotifications(): NotificationsState {
    const ctx = useContext(NotificationsContext);
    if (!ctx) throw new Error('useNotifications は NotificationsProvider の内側で使用してください');
    return ctx;
}

/** Follow の通知で承認・拒否のボタンを出すか（まだ返事をしていない申請か）。 */
export const isPendingFollow = (n: AppNotification, incomingIds: ReadonlySet<string>): boolean =>
    n.type === 'Follow' && incomingIds.has(n.actor.id);
