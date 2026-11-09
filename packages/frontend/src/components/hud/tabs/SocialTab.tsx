import type { FriendsResponse, Instance } from '@ubichill/shared';
import { useCallback, useEffect, useState } from 'react';
import {
    FriendGrid,
    FriendGroup,
    FriendPlaceGroup,
    UserRow,
    UserSearch,
    useFriendLocations,
} from '@/components/social';
import {
    arrangeFriendPresence,
    type FriendPresence,
    friendDirectory,
    placeFriendCards,
    requestTargetOf,
} from '@/components/social/friendPresence';
import { useInviteActions } from '@/components/social/useInviteActions';
import { fetchFriends } from '@/lib/socialApi';
import { css } from '@/styled-system/css';
import { SplitTab, type SplitTabItem } from './SplitTab';
import type { JoinInstanceHandler } from './shared';

export type SocialSection = 'locations' | 'friends' | 'search';

/**
 * ソーシャル: フレンドの現在地（部屋ごと。自分の部屋は一番上）・すべてのフレンド・ユーザー検索を左で切り替える。
 * 届いた申請は通知、フレンドの解除はその人のプロフィール。
 */
export function SocialTab({
    section,
    onSectionChange,
    currentInstance,
    onJoinInstance,
    onFriendshipChange,
}: {
    section: SocialSection;
    onSectionChange: (next: SocialSection) => void;
    currentInstance: Instance | null;
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

    const presence = locations.data ? arrangeFriendPresence(locations.data, currentInstance) : null;
    const directory = presence ? friendDirectory(presence, Date.now()) : null;
    const items: ReadonlyArray<SplitTabItem<SocialSection>> = [
        { id: 'locations', label: 'フレンドの現在地', icon: 'pin', count: presence?.onlineCount },
        { id: 'friends', label: 'すべてのフレンド', icon: 'users', count: directory?.total },
        { id: 'search', label: 'ユーザーを検索', icon: 'search' },
    ];
    const status = locations.error ? (
        <p className={css({ fontSize: '13px', color: 'errorText' })}>{locations.error}</p>
    ) : (
        !presence && <p className={muted}>読み込み中...</p>
    );

    return (
        <SplitTab label="ソーシャル" items={items} current={section} onSelect={onSectionChange}>
            {section === 'locations' && (
                <div className={column}>
                    {status}
                    {presence && (
                        <FriendLocations
                            presence={presence}
                            onJoinInstance={onJoinInstance}
                            onFindFriends={directory?.total === 0 ? () => onSectionChange('search') : undefined}
                        />
                    )}
                </div>
            )}
            {section === 'friends' && (
                <div className={column}>
                    {status}
                    {directory && directory.total === 0 && (
                        <EmptyNote
                            text="まだフレンドがいません"
                            action="ユーザーを検索"
                            onAction={() => onSectionChange('search')}
                        />
                    )}
                    {directory && directory.online.length > 0 && (
                        <FriendGroup title="オンライン" count={directory.online.length}>
                            <FriendGrid cards={directory.online} />
                        </FriendGroup>
                    )}
                    {directory && directory.unreachable.length > 0 && (
                        <FriendGroup title="確認できない" count={directory.unreachable.length}>
                            <FriendGrid cards={directory.unreachable} />
                        </FriendGroup>
                    )}
                    {directory && directory.offline.length > 0 && (
                        <FriendGroup title="オフライン" count={directory.offline.length}>
                            <FriendGrid cards={directory.offline} />
                        </FriendGroup>
                    )}
                    {friends && friends.outgoing.length > 0 && (
                        <FriendGroup title="申請中" count={friends.outgoing.length}>
                            <ul className={css({ display: 'flex', flexDirection: 'column', gap: '1' })}>
                                {friends.outgoing.map((u) => (
                                    <UserRow key={u.id} user={u} friendship="outgoing" onChange={changed} />
                                ))}
                            </ul>
                        </FriendGroup>
                    )}
                </div>
            )}
            {section === 'search' && <UserSearch onFriendshipChange={changed} />}
        </SplitTab>
    );
}

/** 部屋ごとのフレンド（自分の部屋 → ほかの部屋 → 見えない部屋）。だれもオンラインでなければその旨。 */
function FriendLocations({
    presence,
    onJoinInstance,
    onFindFriends,
}: {
    presence: FriendPresence;
    onJoinInstance: JoinInstanceHandler;
    /** フレンドがいないとき、検索へ案内する */
    onFindFriends?: () => void;
}) {
    const { request } = useInviteActions();
    const [requested, setRequested] = useState<ReadonlySet<string>>(new Set());
    const join = (instance: Instance) =>
        onJoinInstance(instance.id, instance.world.id, {
            thumbnail: instance.world.thumbnail,
            displayName: instance.world.displayName,
        });

    if (presence.onlineCount === 0) {
        return onFindFriends ? (
            <EmptyNote text="まだフレンドがいません" action="ユーザーを検索" onAction={onFindFriends} />
        ) : (
            <EmptyNote text="オンラインのフレンドはいません" />
        );
    }
    return (
        <>
            {presence.here && presence.here.friends.length > 0 && <FriendPlaceGroup place={presence.here} here />}
            {presence.places.map((place) => {
                const target = requestTargetOf(place);
                const ask = async () => {
                    if (target && (await request(target)))
                        setRequested((prev) => new Set([...prev, place.instance.id]));
                };
                return (
                    <FriendPlaceGroup
                        key={place.instance.id}
                        place={place}
                        onJoin={() => join(place.instance)}
                        onRequest={target ? () => void ask() : undefined}
                        requested={requested.has(place.instance.id)}
                    />
                );
            })}
            {presence.hidden.length > 0 && (
                <FriendGroup title="プライベートな部屋" count={presence.hidden.length}>
                    <FriendGrid cards={placeFriendCards(presence.hidden)} />
                </FriendGroup>
            )}
        </>
    );
}

function EmptyNote({ text, action, onAction }: { text: string; action?: string; onAction?: () => void }) {
    return (
        <div className={css({ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '2', py: '4' })}>
            <p className={muted}>{text}</p>
            {action && onAction && (
                <button type="button" className={linkButton} onClick={onAction}>
                    {action}
                </button>
            )}
        </div>
    );
}

const column = css({ display: 'flex', flexDirection: 'column', gap: '3' });

const muted = css({ fontSize: '13px', color: 'textMuted' });

const linkButton = css({
    p: 0,
    bg: 'transparent',
    border: 'none',
    color: 'primaryHighlight',
    fontSize: '13px',
    fontWeight: '700',
    cursor: 'pointer',
    _hover: { textDecoration: 'underline' },
});
