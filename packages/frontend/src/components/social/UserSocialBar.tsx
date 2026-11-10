import { type Friendship, isRemoteUserId, type RemoteRelation } from '@ubichill/shared';
import { useEffect, useState } from 'react';
import { HudIcon } from '@/components/hud/HudIcon';
import { useHudNavigation } from '@/components/hud/HudNavigationContext';
import { fetchUserWithFriendship } from '@/lib/socialApi';
import { css, cx } from '@/styled-system/css';
import { socialButton } from './buttons';
import { FriendButton } from './FriendButton';

/**
 * ほかの人のプロフィール: 自分との関係の操作。フレンドのいまいる場所（入る・リクエスト・招待）は ProfileLocationCard。
 * このサーバーのフレンドには「メッセージ」（会話はランチパッドの中で開くので、ランチパッドの外のページでは出さない）。
 */
export function UserSocialBar({ userId, name }: { userId: string; name: string }) {
    const [friendship, setFriendship] = useState<Friendship | null>(null);
    const [relation, setRelation] = useState<RemoteRelation>({});
    const hud = useHudNavigation();

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
    const canMessage = friendship === 'friends' && !isRemoteUserId(userId) && !!hud;
    return (
        <div className={bar}>
            <FriendButton
                user={{ id: userId, name }}
                friendship={friendship}
                relation={relation}
                onChange={setFriendship}
            />
            {canMessage && (
                <button
                    type="button"
                    className={cx(socialButton({ tone: 'primary' }), messageButton)}
                    onClick={() => hud?.openConversation(userId)}
                >
                    <HudIcon name="message" size={14} />
                    メッセージ
                </button>
            )}
        </div>
    );
}

const messageButton = css({ display: 'inline-flex', alignItems: 'center', gap: '1.5' });

const bar = css({
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: '2',
    mb: '3',
});
