import { ACCESS_TYPE_LABELS, type Friendship, type Instance, type RemoteRelation } from '@ubichill/shared';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useHudNavigation } from '@/components/hud/HudNavigationContext';
import { fetchFriendLocations, fetchUserWithFriendship } from '@/lib/socialApi';
import { css } from '@/styled-system/css';
import { socialButton } from './buttons';
import { FriendButton } from './FriendButton';
import { useInviteActions } from './useInviteActions';

type Location = { kind: 'instance'; instance: Instance } | { kind: 'private' } | { kind: 'none' };

/**
 * ほかの人のプロフィール: 自分との関係の操作と、フレンドならいまいる場所。
 * 入れる部屋なら「合流する」、招待が要る・見えない部屋なら「リクエスト」、自分が部屋にいれば「招待」。
 */
export function UserSocialBar({ userId, name }: { userId: string; name: string }) {
    const navigate = useNavigate();
    const hud = useHudNavigation();
    const { canInvite, currentInstanceId, invite, request } = useInviteActions();
    const [friendship, setFriendship] = useState<Friendship | null>(null);
    const [relation, setRelation] = useState<RemoteRelation>({});
    const [location, setLocation] = useState<Location>({ kind: 'none' });
    const [done, setDone] = useState<{ invited: boolean; requested: boolean }>({ invited: false, requested: false });

    useEffect(() => {
        const ctrl = { cancelled: false };
        fetchUserWithFriendship(userId)
            .then((u) => {
                if (ctrl.cancelled) return;
                setFriendship(u.friendship);
                setRelation({
                    ...(u.friendsUnsupported ? { friendsUnsupported: true } : {}),
                    ...(u.followsYou ? { followsYou: u.followsYou } : {}),
                });
            })
            .catch(() => !ctrl.cancelled && setFriendship(null));
        return () => {
            ctrl.cancelled = true;
        };
    }, [userId]);

    useEffect(() => {
        if (friendship !== 'friends') {
            setLocation({ kind: 'none' });
            return;
        }
        const ctrl = { cancelled: false };
        fetchFriendLocations()
            .then((data) => {
                if (ctrl.cancelled) return;
                const here = data.locations.find((l) => l.friends.some((f) => f.id === userId));
                setLocation(
                    here
                        ? { kind: 'instance', instance: here.instance }
                        : data.private.some((f) => f.id === userId)
                          ? { kind: 'private' }
                          : { kind: 'none' },
                );
            })
            .catch(() => undefined);
        return () => {
            ctrl.cancelled = true;
        };
    }, [friendship, userId]);

    if (!friendship || friendship === 'self') return null;
    const friends = friendship === 'friends';
    const room = location.kind === 'instance' ? location.instance : null;
    const withMe = room !== null && room.id === currentInstanceId;
    const canEnter = room !== null && !withMe && room.canJoin !== false;
    const needsInvite = (room !== null && room.canJoin === false) || location.kind === 'private';

    const join = (instance: Instance) => {
        const worldData = { thumbnail: instance.world.thumbnail, displayName: instance.world.displayName };
        if (hud) hud.joinInstance(instance.id, instance.world.id, worldData);
        else navigate(`/instance/${instance.id}`, { state: { worldId: instance.world.id, worldData } });
    };

    return (
        <div className={bar}>
            <span className={css({ fontSize: '13px', color: 'textMuted', minW: 0 })}>
                {room && (
                    <>
                        <strong className={css({ color: 'text' })}>{room.world.displayName}</strong>
                        {withMe
                            ? '（いっしょにいます）'
                            : `（${ACCESS_TYPE_LABELS[room.access.type]}・${room.stats.currentUsers}/${room.stats.maxUsers}人）`}
                    </>
                )}
                {location.kind === 'private' && 'プライベートな部屋にいます'}
                {location.kind === 'none' && friends && 'オフライン'}
            </span>
            <span className={css({ display: 'inline-flex', flexWrap: 'wrap', gap: '2', alignItems: 'center' })}>
                {room && canEnter && (
                    <button type="button" className={socialButton({ tone: 'primary' })} onClick={() => join(room)}>
                        合流する
                    </button>
                )}
                {friends && needsInvite && (
                    <button
                        type="button"
                        className={socialButton({ tone: 'primary' })}
                        disabled={done.requested}
                        onClick={() =>
                            void request({ id: userId }).then((ok) => ok && setDone((d) => ({ ...d, requested: true })))
                        }
                    >
                        {done.requested ? 'リクエスト済み' : 'リクエスト'}
                    </button>
                )}
                {friends && canInvite && !withMe && (
                    <button
                        type="button"
                        className={socialButton()}
                        disabled={done.invited}
                        onClick={() =>
                            void invite({ id: userId }).then((ok) => ok && setDone((d) => ({ ...d, invited: true })))
                        }
                    >
                        {done.invited ? '招待済み' : '招待'}
                    </button>
                )}
                <FriendButton
                    user={{ id: userId, name }}
                    friendship={friendship}
                    relation={relation}
                    onChange={setFriendship}
                />
            </span>
        </div>
    );
}

const bar = css({
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '3',
    mb: '4',
    px: '4',
    py: '3',
    bg: 'surface',
    borderRadius: '12px',
});
