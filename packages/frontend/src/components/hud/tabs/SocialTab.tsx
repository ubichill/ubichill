import type { FriendsResponse, Instance, UserSummary } from '@ubichill/shared';
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { HudIcon } from '@/components/hud/HudIcon';
import { FriendTile, PlaceCard, UserRow, UserSearch, useFriendLocations } from '@/components/social';
import { arrangeFriendPresence, requestTargetOf } from '@/components/social/friendPresence';
import { useInviteActions } from '@/components/social/useInviteActions';
import { fetchFriends } from '@/lib/socialApi';
import { css, cva } from '@/styled-system/css';
import { type JoinInstanceHandler, tabPanel } from './shared';

/**
 * ソーシャル: フレンドがいまどこにいるか（部屋ごと。自分の部屋は一番上）・ユーザー検索・送った申請。
 * 届いた申請は通知、フレンドの解除はその人のプロフィール。
 */
export function SocialTab({
    currentInstance,
    onJoinInstance,
    onFriendshipChange,
}: {
    currentInstance: Instance | null;
    onJoinInstance: JoinInstanceHandler;
    onFriendshipChange?: () => void;
}) {
    const locations = useFriendLocations();
    const { request } = useInviteActions();
    const [requested, setRequested] = useState<ReadonlySet<string>>(new Set());
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
    const join = (instance: Instance) =>
        onJoinInstance(instance.id, instance.world.id, {
            thumbnail: instance.world.thumbnail,
            displayName: instance.world.displayName,
        });
    const noFriends = friends !== null && friends.friends.length === 0;

    return (
        <div className={tabPanel} onClick={(e) => e.stopPropagation()}>
            {presence?.here && (
                <PlaceCard instance={presence.here.instance} here>
                    <FriendGrid users={presence.here.friends} />
                </PlaceCard>
            )}

            <UserSearch onFriendshipChange={changed} />

            {locations.error && <p className={css({ fontSize: '13px', color: 'errorText' })}>{locations.error}</p>}
            {!presence && !locations.error && <p className={muted}>読み込み中...</p>}
            {noFriends && <p className={muted}>上の検索から、フレンドを探せます</p>}

            {presence && !noFriends && (
                <Group label="オンライン" count={presence.onlineCount} tone="online">
                    {presence.places.map((place) => {
                        const target = requestTargetOf(place);
                        const ask = async () => {
                            if (target && (await request(target)))
                                setRequested((prev) => new Set([...prev, place.instance.id]));
                        };
                        return (
                            <PlaceCard
                                key={place.instance.id}
                                instance={place.instance}
                                onJoin={() => join(place.instance)}
                                onRequest={target ? () => void ask() : undefined}
                                requested={requested.has(place.instance.id)}
                            >
                                <FriendGrid users={place.friends} />
                            </PlaceCard>
                        );
                    })}
                    {presence.hidden.length > 0 && (
                        <div className={css({ display: 'flex', flexDirection: 'column', gap: '1' })}>
                            <h3 className={subheading}>
                                <HudIcon name="lock" size={14} />
                                プライベート
                            </h3>
                            <FriendGrid users={presence.hidden} />
                        </div>
                    )}
                </Group>
            )}

            {presence && presence.offline.length > 0 && (
                <Group label="オフライン" count={presence.offline.length} tone="offline">
                    <FriendGrid users={presence.offline} offline />
                </Group>
            )}

            {friends && friends.outgoing.length > 0 && (
                <Group label="申請中" count={friends.outgoing.length}>
                    <ul className={css({ display: 'flex', flexDirection: 'column', gap: '1' })}>
                        {friends.outgoing.map((u) => (
                            <UserRow key={u.id} user={u} friendship="outgoing" onChange={changed} />
                        ))}
                    </ul>
                </Group>
            )}
        </div>
    );
}

function Group({
    label,
    count,
    tone,
    children,
}: {
    label: string;
    count: number;
    tone?: 'online' | 'offline';
    children: ReactNode;
}) {
    return (
        <section className={css({ display: 'flex', flexDirection: 'column', gap: '3' })}>
            <h2 className={groupHeading}>
                {tone && <span className={dot({ tone })} aria-hidden="true" />}
                {label}
                <span className={css({ color: 'textSubtle', fontWeight: '600' })}>{count}</span>
            </h2>
            {children}
        </section>
    );
}

function FriendGrid({ users, offline }: { users: UserSummary[]; offline?: boolean }) {
    if (users.length === 0) return null;
    return (
        <div className={friendGrid}>
            {users.map((u) => (
                <FriendTile key={u.id} user={u} presence={offline ? 'offline' : 'online'} />
            ))}
        </div>
    );
}

const muted = css({ fontSize: '13px', color: 'textMuted' });

const groupHeading = css({
    display: 'flex',
    alignItems: 'center',
    gap: '2',
    fontSize: '14px',
    fontWeight: '800',
    color: 'text',
});

const subheading = css({
    display: 'flex',
    alignItems: 'center',
    gap: '1.5',
    px: '2',
    fontSize: '12px',
    fontWeight: '700',
    color: 'textMuted',
});

const dot = cva({
    base: { w: '8px', h: '8px', borderRadius: 'full' },
    variants: { tone: { online: { bg: 'hudStatusOn' }, offline: { bg: 'borderStrong' } } },
});

const friendGrid = css({
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(168px, 1fr))',
    gap: '0.5',
});
