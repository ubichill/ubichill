import type { FriendsResponse } from '@ubichill/shared';
import { useCallback, useEffect, useState } from 'react';
import { FriendLists, UserSearch } from '@/components/social';
import { fetchFriends } from '@/lib/socialApi';
import { css } from '@/styled-system/css';
import { cardStyle, sectionHeading, tabPanel } from './shared';

/** フレンドタブ: ユーザー検索と、フレンド・申請中の一覧（あなたへのリクエストは通知タブ）。 */
export function FriendsTab({ onFriendshipChange }: { onFriendshipChange?: () => void }) {
    const [friends, setFriends] = useState<FriendsResponse | null>(null);
    const reload = useCallback(() => {
        fetchFriends()
            .then(setFriends)
            .catch(() => undefined);
        onFriendshipChange?.();
    }, [onFriendshipChange]);
    useEffect(() => {
        fetchFriends()
            .then(setFriends)
            .catch(() => undefined);
    }, []);

    return (
        <div className={tabPanel} onClick={(e) => e.stopPropagation()}>
            <div className={cardStyle}>
                <h2 className={sectionHeading}>ユーザーを探す</h2>
                <UserSearch onFriendshipChange={reload} />
            </div>
            <div className={cardStyle}>
                <h2 className={sectionHeading}>フレンド</h2>
                {friends ? (
                    <FriendLists data={{ ...friends, incoming: [] }} onChange={reload} />
                ) : (
                    <p className={css({ fontSize: '13px', color: 'textMuted' })}>読み込み中...</p>
                )}
            </div>
        </div>
    );
}
