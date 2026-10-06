import { ACCESS_TYPE_LABELS, type Friendship, type Instance } from '@ubichill/shared';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { fetchFriendLocations, fetchUserWithFriendship } from '@/lib/socialApi';
import { css } from '@/styled-system/css';
import { socialButton } from './buttons';
import { FriendButton } from './FriendButton';

type Location = { kind: 'instance'; instance: Instance } | { kind: 'private' } | { kind: 'none' };

/** ほかの人のユーザーページ: 自分との関係の操作と、フレンドならいまいる場所。 */
export function UserSocialBar({ userId, name }: { userId: string; name: string }) {
    const navigate = useNavigate();
    const [friendship, setFriendship] = useState<Friendship | null>(null);
    const [location, setLocation] = useState<Location>({ kind: 'none' });

    useEffect(() => {
        const ctrl = { cancelled: false };
        fetchUserWithFriendship(userId)
            .then((u) => !ctrl.cancelled && setFriendship(u.friendship))
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
    return (
        <div
            className={css({
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '3',
                mb: '4',
                px: '4',
                py: '3',
                bg: 'surface',
                border: '1px solid',
                borderColor: 'border',
                borderRadius: '12px',
            })}
        >
            <span className={css({ fontSize: '13px', color: 'textMuted' })}>
                {location.kind === 'instance' && (
                    <>
                        いまいる場所:{' '}
                        <strong className={css({ color: 'text' })}>{location.instance.world.displayName}</strong>（
                        {ACCESS_TYPE_LABELS[location.instance.access.type]}・{location.instance.stats.currentUsers}/
                        {location.instance.stats.maxUsers}人）
                    </>
                )}
                {location.kind === 'private' && '非公開の場所にいます'}
                {location.kind === 'none' && friendship === 'friends' && 'インスタンスにいません'}
            </span>
            <span className={css({ display: 'inline-flex', gap: '2', alignItems: 'center' })}>
                {location.kind === 'instance' && (
                    <button
                        type="button"
                        className={socialButton({ tone: 'primary' })}
                        onClick={() => navigate(`/instance/${location.instance.id}`)}
                    >
                        合流する
                    </button>
                )}
                <FriendButton user={{ id: userId, name }} friendship={friendship} onChange={setFriendship} />
            </span>
        </div>
    );
}
