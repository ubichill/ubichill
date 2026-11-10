import type { Friendship, RemoteRelation } from '@ubichill/shared';
import { useState } from 'react';
import { useConfirm } from '@/components/ui/ConfirmProvider';
import { answerFollower } from '@/lib/fediverseApi';
import { type FollowerAction, followerActionsOf, relationAfter, relationBadgesOf } from '@/lib/friendActions';
import { pushToast } from '@/lib/toast';
import { css } from '@/styled-system/css';
import { socialButton } from './buttons';
import { FriendButton } from './FriendButton';

/** バナーの左上: 相手との関係（フォローされている・フレンド）。 */
export function ProfileRelationBadges({ friendship, relation }: { friendship: Friendship; relation: RemoteRelation }) {
    const badges = relationBadgesOf(friendship, relation);
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

/** バナーの右上: フレンドの操作と、フォローしてきた人への操作（承認・拒否・フォロワーから外す）。 */
export function ProfileRelationActions({
    user,
    friendship,
    relation,
    onFriendshipChange,
    onRelationChange,
}: {
    user: { id: string; name: string };
    friendship: Friendship;
    relation: RemoteRelation;
    onFriendshipChange: (next: Friendship) => void;
    onRelationChange: (next: RemoteRelation) => void;
}) {
    const confirm = useConfirm();
    const [busy, setBusy] = useState(false);

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
