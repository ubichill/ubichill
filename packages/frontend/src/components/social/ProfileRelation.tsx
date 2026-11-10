import type { Friendship, RemoteRelation } from '@ubichill/shared';
import { useState } from 'react';
import { useConfirm } from '@/components/ui/ConfirmProvider';
import { blockAndReload, unblockAndReload } from '@/lib/blocks';
import { answerFollower } from '@/lib/fediverseApi';
import { type FollowerAction, followerActionsOf, relationAfter, relationBadgesOf } from '@/lib/friendActions';
import { useSession } from '@/lib/session';
import { pushToast } from '@/lib/toast';
import { css } from '@/styled-system/css';
import { socialButton } from './buttons';
import { FriendButton } from './FriendButton';

/** バナーの左上: 相手との関係（フォローされている・フレンド）。 */
export function ProfileRelationBadges({
    friendship,
    relation,
    blocked,
}: {
    friendship: Friendship;
    relation: RemoteRelation;
    blocked: boolean;
}) {
    const badges = blocked ? ['ブロック中'] : relationBadgesOf(friendship, relation);
    if (badges.length === 0) return null;
    return (
        <span className={css({ display: 'flex', flexWrap: 'wrap', gap: '1.5' })}>
            {badges.map((label) => (
                <span key={label} className={badge}>
                    {label}
                </span>
            ))}
        </span>
    );
}

/**
 * バナーの右上: フレンドの操作と、フォローしてきた人への操作（承認・拒否・フォロワーから外す）、ブロック。
 * ブロック中は解除だけを出す。
 */
export function ProfileRelationActions({
    user,
    friendship,
    relation,
    blocked,
    onFriendshipChange,
    onRelationChange,
    onBlockedChange,
}: {
    user: { id: string; name: string };
    friendship: Friendship;
    relation: RemoteRelation;
    blocked: boolean;
    onFriendshipChange: (next: Friendship) => void;
    onRelationChange: (next: RemoteRelation) => void;
    onBlockedChange: (next: boolean) => void;
}) {
    const { data: session } = useSession();
    const confirm = useConfirm();
    const [busy, setBusy] = useState(false);
    const owner = session?.user.id;

    const toggleBlock = async () => {
        if (!owner) return;
        const next = !blocked;
        if (
            next &&
            !(await confirm(
                `${user.name} をブロックしますか？フレンドと申請は消え、この人は見えなくなり、この人が作った mod は読み込まなくなります。`,
            ))
        )
            return;
        setBusy(true);
        try {
            await (next ? blockAndReload(owner, user.id) : unblockAndReload(owner, user.id));
            onBlockedChange(next);
        } catch (e) {
            pushToast(e instanceof Error ? e.message : '操作できませんでした', 'error');
        } finally {
            setBusy(false);
        }
    };

    const blockButton = (
        <button
            type="button"
            disabled={busy}
            className={socialButton({ tone: blocked ? 'secondary' : 'danger' })}
            onClick={() => void toggleBlock()}
        >
            {blocked ? 'ブロックを解除' : 'ブロック'}
        </button>
    );

    if (blocked) return blockButton;

    const answer = async (action: FollowerAction, confirmMessage?: string) => {
        if (confirmMessage && !(await confirm(confirmMessage))) return;
        setBusy(true);
        try {
            await answerFollower(user.id, action === 'approve' ? 'approve' : 'reject');
            onRelationChange(relationAfter(relation, action));
        } catch (e) {
            pushToast(e instanceof Error ? e.message : '操作できませんでした', 'error');
        } finally {
            setBusy(false);
        }
    };

    return (
        <span className={css({ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: '2' })}>
            {followerActionsOf(relation, user.name).map((a) => (
                <button
                    key={a.action}
                    type="button"
                    disabled={busy}
                    className={socialButton({ tone: a.tone })}
                    onClick={() => void answer(a.action, a.confirm)}
                >
                    {a.label}
                </button>
            ))}
            {/* 関係（フレンド・フォロー）は左上の札で出すので、ここはボタンだけ */}
            <FriendButton
                user={user}
                friendship={friendship}
                relation={{ ...(relation.friendsUnsupported ? { friendsUnsupported: true } : {}) }}
                showStatus={false}
                onChange={onFriendshipChange}
            />
            {blockButton}
        </span>
    );
}

const badge = css({
    px: '2.5',
    py: '1',
    borderRadius: '8px',
    bg: 'hudBg',
    color: 'hudText',
    fontSize: '12px',
    fontWeight: '700',
    backdropFilter: 'blur(4px)',
});
