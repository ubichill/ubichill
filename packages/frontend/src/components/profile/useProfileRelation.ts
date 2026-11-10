import { useState } from 'react';
import { useHudNavigation } from '@/components/hud/HudNavigationContext';
import { useConfirm } from '@/components/ui/ConfirmProvider';
import { blockAndReload, unblockAndReload } from '@/lib/blocks';
import { answerFollower } from '@/lib/fediverseApi';
import { relationAfter } from '@/lib/friendActions';
import { type ProfileAction, profileActionsOf } from '@/lib/profileActions';
import { useSession } from '@/lib/session';
import { sendFriendAction } from '@/lib/socialApi';
import { pushToast } from '@/lib/toast';
import type { UserRelationSource } from './userRelation';
import { useUserRelation } from './useUserRelation';

/**
 * ほかの人のプロフィールのバナーの札と操作、その実行。source が null（自分・未ログイン）なら null。
 * フレンドの操作の失敗はボタンの横に、ほかの操作の失敗はトーストで出す。
 */
export function useProfileRelation(source: UserRelationSource | null, user: { id: string; name: string } | null) {
    const people = useUserRelation(source);
    const { data: session } = useSession();
    const hud = useHudNavigation();
    const confirm = useConfirm();
    const [busy, setBusy] = useState(false);
    const [friendError, setFriendError] = useState<string | null>(null);
    const viewerId = session?.user.id ?? null;

    if (!people.friendship || !user) return null;

    const view = profileActionsOf({
        user,
        viewerId,
        friendship: people.friendship,
        relation: people.relation,
        blocked: people.blocked,
        inLaunchpad: !!hud,
    });

    const perform = async (action: ProfileAction): Promise<void> => {
        switch (action.kind) {
            case 'follower':
                await answerFollower(user.id, action.action === 'approve' ? 'approve' : 'reject');
                people.setRelation(relationAfter(people.relation, action.action));
                return;
            case 'friend':
                people.setFriendship(await sendFriendAction(action.action, user.id));
                return;
            case 'block':
                if (!viewerId) return;
                await (action.block ? blockAndReload(viewerId, user.id) : unblockAndReload(viewerId, user.id));
                people.setBlocked(action.block);
                return;
            case 'message':
                hud?.openConversation(user.id);
                return;
        }
    };

    const run = async (action: ProfileAction) => {
        if (action.kind !== 'message' && action.confirm && !(await confirm(action.confirm))) return;
        setBusy(true);
        if (action.kind === 'friend') setFriendError(null);
        try {
            await perform(action);
        } catch (e) {
            const message = e instanceof Error ? e.message : '操作できませんでした';
            if (action.kind === 'friend') setFriendError(message);
            else pushToast(message, 'error');
        } finally {
            setBusy(false);
        }
    };

    return { ...view, run, busy, friendError };
}
