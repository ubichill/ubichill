import type { FriendsResponse } from '@ubichill/shared';
import { useCallback, useEffect, useState } from 'react';
import { FriendLists, FriendLocations, UserSearch, useFriendLocations } from '@/components/social';
import { fetchFriends } from '@/lib/socialApi';
import { css } from '@/styled-system/css';
import { cardStyle, type JoinInstanceHandler, sectionHeading, tabPanel } from './shared';

/**
 * ソーシャルタブ: フレンドがいま入っているインスタンス（自分に見えるものだけ）・ユーザー検索・フレンドと申請中の一覧。
 * あなたへのフレンドリクエストは通知タブ。
 */
export function SocialTab({
    currentInstanceId,
    onJoinInstance,
    onFriendshipChange,
}: {
    currentInstanceId?: string;
    onJoinInstance: JoinInstanceHandler;
    onFriendshipChange?: () => void;
}) {
    const locations = useFriendLocations();
    const [friends, setFriends] = useState<FriendsResponse | null>(null);
    const loadFriends = useCallback(() => {
        fetchFriends()
            .then(setFriends)
            .catch(() => undefined);
    }, []);
    useEffect(() => {
        loadFriends();
    }, [loadFriends]);
    const changed = () => {
        loadFriends();
        void locations.reload();
        onFriendshipChange?.();
    };

    const here = locations.data ? locations.data.locations.reduce((n, l) => n + l.friends.length, 0) : 0;
    const muted = css({ fontSize: '13px', color: 'textMuted' });

    return (
        <div className={tabPanel} onClick={(e) => e.stopPropagation()}>
            <div className={cardStyle}>
                <h2 className={sectionHeading}>フレンドの現在地（{here}）</h2>
                {locations.error && <p className={css({ fontSize: '13px', color: 'errorText' })}>{locations.error}</p>}
                {locations.data ? (
                    <FriendLocations
                        data={locations.data}
                        currentInstanceId={currentInstanceId}
                        onJoin={(instance) =>
                            onJoinInstance(instance.id, instance.world.id, {
                                thumbnail: instance.world.thumbnail,
                                displayName: instance.world.displayName,
                            })
                        }
                    />
                ) : (
                    !locations.error && <p className={muted}>読み込み中...</p>
                )}
            </div>
            <div className={cardStyle}>
                <h2 className={sectionHeading}>ユーザーを探す</h2>
                <UserSearch onFriendshipChange={changed} />
            </div>
            <div className={cardStyle}>
                <h2 className={sectionHeading}>フレンド</h2>
                {friends ? (
                    <FriendLists data={{ ...friends, incoming: [] }} onChange={changed} />
                ) : (
                    <p className={muted}>読み込み中...</p>
                )}
            </div>
        </div>
    );
}
