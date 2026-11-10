import type { Friendship, RemoteRelation } from '@ubichill/shared';
import { useEffect, useState } from 'react';
import { useConfirm } from '@/components/ui/ConfirmProvider';
import { blockAndReload, unblockAndReload } from '@/lib/blocks';
import { useSession } from '@/lib/session';
import { fetchUserWithFriendship } from '@/lib/socialApi';
import { css } from '@/styled-system/css';
import { socialButton } from './buttons';
import { FriendButton } from './FriendButton';

/**
 * ほかの人のプロフィール: 自分との関係の操作（フレンド・ブロック）。フレンドのいまいる場所（入る・リクエスト・招待）は ProfileLocationCard。
 */
export function UserSocialBar({ userId, name }: { userId: string; name: string }) {
    const { data: session } = useSession();
    const confirm = useConfirm();
    const [friendship, setFriendship] = useState<Friendship | null>(null);
    const [relation, setRelation] = useState<RemoteRelation>({});
    const [blocked, setBlocked] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const ctrl = { cancelled: false };
        fetchUserWithFriendship(userId)
            .then((u) => {
                if (ctrl.cancelled) return;
                setFriendship(u.friendship);
                setBlocked(u.blocked === true);
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

    const owner = session?.user.id;
    if (!friendship || friendship === 'self' || !owner) return null;

    const toggleBlock = async () => {
        const next = !blocked;
        if (
            next &&
            !(await confirm(
                `${name} をブロックしますか？フレンドと申請は消え、この人は見えなくなり、この人が作った mod は読み込まなくなります。`,
            ))
        )
            return;
        setBusy(true);
        setError(null);
        try {
            await (next ? blockAndReload(owner, userId) : unblockAndReload(owner, userId));
            setBlocked(next);
            if (next) setFriendship('none');
        } catch (e) {
            setError(e instanceof Error ? e.message : '操作できませんでした');
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className={bar}>
            {blocked ? (
                <span className={css({ fontSize: '12px', color: 'textMuted' })}>ブロック中</span>
            ) : (
                <FriendButton
                    user={{ id: userId, name }}
                    friendship={friendship}
                    relation={relation}
                    onChange={setFriendship}
                />
            )}
            <button
                type="button"
                disabled={busy}
                className={socialButton({ tone: blocked ? 'secondary' : 'danger' })}
                onClick={() => void toggleBlock()}
            >
                <span className={css({ display: 'inline-flex', alignItems: 'center', gap: '1' })}>
                    <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        aria-hidden="true"
                    >
                        <circle cx="12" cy="12" r="9" />
                        <path d="M5.6 5.6l12.8 12.8" />
                    </svg>
                    {blocked ? 'ブロックを解除' : 'ブロック'}
                </span>
            </button>
            {error && <span className={css({ fontSize: '12px', color: 'errorText' })}>{error}</span>}
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
