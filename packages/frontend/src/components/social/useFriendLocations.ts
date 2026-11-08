import { useCallback, useEffect, useState } from 'react';
import { rememberFriendLocations } from '@/lib/joinVia';
import { type FriendLocationsResponse, fetchFriendLocations } from '@/lib/socialApi';

/**
 * フレンドの現在地を定期的に取り直す（入退室はサーバーからの通知ではなく読み直しで反映する）。
 * タブが隠れている間は取りに行かず、戻ってきたらすぐ取り直す。
 */
export function useFriendLocations(intervalMs = 15000) {
    const [data, setData] = useState<FriendLocationsResponse | null>(null);
    const [error, setError] = useState<string | null>(null);

    const reload = useCallback(async () => {
        try {
            const located = await fetchFriendLocations();
            rememberFriendLocations(located.locations);
            setData(located);
            setError(null);
        } catch (e) {
            setError(e instanceof Error ? e.message : '読み込めませんでした');
        }
    }, []);

    useEffect(() => {
        void reload();
        const timer = setInterval(() => {
            if (!document.hidden) void reload();
        }, intervalMs);
        const onVisible = () => {
            if (!document.hidden) void reload();
        };
        document.addEventListener('visibilitychange', onVisible);
        return () => {
            clearInterval(timer);
            document.removeEventListener('visibilitychange', onVisible);
        };
    }, [reload, intervalMs]);

    return { data, error, reload };
}
