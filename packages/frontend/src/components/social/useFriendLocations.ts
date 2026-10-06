import { useCallback, useEffect, useState } from 'react';
import { type FriendLocationsResponse, fetchFriendLocations } from '@/lib/socialApi';

/** フレンドの現在地を定期的に取り直す（入退室はサーバーからの通知ではなく読み直しで反映する）。 */
export function useFriendLocations(intervalMs = 15000) {
    const [data, setData] = useState<FriendLocationsResponse | null>(null);
    const [error, setError] = useState<string | null>(null);

    const reload = useCallback(async () => {
        try {
            setData(await fetchFriendLocations());
            setError(null);
        } catch (e) {
            setError(e instanceof Error ? e.message : '読み込めませんでした');
        }
    }, []);

    useEffect(() => {
        void reload();
        const timer = setInterval(() => void reload(), intervalMs);
        return () => clearInterval(timer);
    }, [reload, intervalMs]);

    return { data, error, reload };
}
