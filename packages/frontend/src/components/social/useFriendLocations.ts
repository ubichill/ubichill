import { useEffect, useSyncExternalStore } from 'react';
import { useSession } from '@/lib/session';
import { type FriendLocationsResponse, fetchFriendLocations } from '@/lib/social/socialApi';
import { rememberFriendLocations } from '@/lib/worlds/joinVia';
import { createSharedPoll } from './sharedPoll';

const friendLocations = createSharedPoll<FriendLocationsResponse>({
    async load() {
        const located = await fetchFriendLocations();
        rememberFriendLocations(located.locations);
        return located;
    },
    intervalMs: 15_000,
    staleMs: 5_000,
    now: () => Date.now(),
    isHidden: () => document.hidden,
    onVisible(callback) {
        const listener = () => {
            if (!document.hidden) callback();
        };
        document.addEventListener('visibilitychange', listener);
        return () => document.removeEventListener('visibilitychange', listener);
    },
});

/**
 * フレンドの現在地（ランチパッド・ソーシャル・プロフィールで 1 つを共有する）。入退室はサーバーからの通知ではなく読み直しで反映する。
 * タブが隠れている間は取りに行かず、戻ってきたらすぐ取り直す。
 */
export function useFriendLocations() {
    const userId = useSession().data?.user.id;
    useEffect(() => {
        friendLocations.setOwner(userId);
    }, [userId]);
    const snapshot = useSyncExternalStore(friendLocations.subscribe, friendLocations.getSnapshot);
    const current = snapshot.owner === userId;
    return {
        data: current ? snapshot.data : null,
        error: current ? snapshot.error : null,
        reload: friendLocations.reload,
    };
}
