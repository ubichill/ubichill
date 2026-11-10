import type { Friendship, RemoteRelation } from '@ubichill/shared';
import { useEffect, useState } from 'react';
import { fetchUserWithFriendship } from '@/lib/socialApi';
import { css } from '@/styled-system/css';
import { FriendButton } from './FriendButton';

/**
 * ほかの人のプロフィール: 自分との関係の操作。フレンドのいまいる場所（入る・リクエスト・招待）は ProfileLocationCard。
 */
export function UserSocialBar({ userId, name }: { userId: string; name: string }) {
    const [friendship, setFriendship] = useState<Friendship | null>(null);
    const [relation, setRelation] = useState<RemoteRelation>({});

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

    if (!friendship || friendship === 'self') return null;
    return (
        <div className={bar}>
            <FriendButton
                user={{ id: userId, name }}
                friendship={friendship}
                relation={relation}
                onChange={setFriendship}
            />
        </div>
    );
}

const bar = css({
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: '2',
    mb: '3',
});
