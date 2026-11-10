import type { Friendship, RemoteRelation, UserSummary } from '@ubichill/shared';
import { useState } from 'react';
import { useConfirm } from '@/components/ui/ConfirmProvider';
import { type FriendAction, followLabelOf, friendActionsOf } from '@/lib/friendActions';
import { sendFriendAction } from '@/lib/socialApi';
import { css } from '@/styled-system/css';
import { socialButton } from './buttons';

/** 相手との関係に応じた操作（申請・取り消し・承認・拒否・解除）。 */
export function FriendButton({
    user,
    friendship,
    relation = {},
    showStatus = true,
    onChange,
}: {
    user: Pick<UserSummary, 'id' | 'name'>;
    friendship: Friendship;
    /** ほかのサーバーの人: フレンドに対応しているか・フェディバースでフォローされているか */
    relation?: RemoteRelation;
    /** 申請中・フレンド・フォローされているかの文字も出す（プロフィールでは札で出すので出さない） */
    showStatus?: boolean;
    onChange: (next: Friendship) => void;
}) {
    const followLabel = followLabelOf(relation);
    const confirm = useConfirm();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handle = async (action: FriendAction, confirmMessage?: string) => {
        if (confirmMessage && !(await confirm(confirmMessage))) return;
        setBusy(true);
        setError(null);
        try {
            onChange(await sendFriendAction(action, user.id));
        } catch (e) {
            setError(e instanceof Error ? e.message : '操作できませんでした');
        } finally {
            setBusy(false);
        }
    };

    return (
        <span className={css({ display: 'inline-flex', alignItems: 'center', gap: '2', flexWrap: 'wrap' })}>
            {showStatus && friendship === 'outgoing' && (
                <span className={css({ fontSize: '12px', color: 'textMuted' })}>申請中</span>
            )}
            {showStatus && friendship === 'friends' && (
                <span className={css({ fontSize: '12px', color: 'successText', fontWeight: '600' })}>フレンド</span>
            )}
            {showStatus && followLabel && (
                <span className={css({ fontSize: '12px', color: 'textMuted' })}>{followLabel}</span>
            )}
            {friendActionsOf(friendship, user.name, relation).map((a) => (
                <button
                    key={a.action}
                    type="button"
                    disabled={busy}
                    className={socialButton({ tone: a.tone })}
                    onClick={() => void handle(a.action, a.confirm)}
                >
                    {a.label}
                </button>
            ))}
            {error && <span className={css({ fontSize: '12px', color: 'errorText' })}>{error}</span>}
        </span>
    );
}
