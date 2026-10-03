import { useCallback, useEffect, useMemo, useState } from 'react';
import { type AppNotification, groupNotifications, notificationsFrom } from '@/lib/notifications';
import { fetchFriends } from '@/lib/socialApi';

/** 通知（いまはフレンドリクエスト）を定期的に取り直す。HUD のバッジと通知タブで同じものを使う。 */
export function useNotifications(intervalMs = 15000) {
    const [items, setItems] = useState<AppNotification[]>([]);

    const reload = useCallback(async () => {
        try {
            const friends = await fetchFriends();
            setItems(notificationsFrom({ incomingFriendRequests: friends.incoming }));
        } catch {
            // ログインしていない・一時的な失敗は、次の取り直しに任せる
        }
    }, []);

    useEffect(() => {
        void reload();
        const timer = setInterval(() => void reload(), intervalMs);
        return () => clearInterval(timer);
    }, [reload, intervalMs]);

    const groups = useMemo(() => groupNotifications(items), [items]);
    return { items, groups, reload };
}

export type NotificationsState = ReturnType<typeof useNotifications>;
