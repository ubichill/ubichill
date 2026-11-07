import { useSocket } from '@ubichill/react';
import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router';
import { useConfirm } from '@/components/ui/ConfirmProvider';
import { homeInstanceEntry, type InstanceEntryState, instanceInviteUrl } from '@/lib/home';
import { ensureHomeInstance } from '@/lib/homeApi';
import { pushToast } from '@/lib/toast';
import type { JoinInstanceHandler } from './tabs/shared';

/**
 * ランチパッドの操作（別の部屋へ移る・ホーム・招待のコピー）。
 * 部屋を移るときは、古い部屋から確実に抜けてから移る。
 */
export function useHudActions({
    currentInstanceId,
    isHome,
    onClose,
}: {
    currentInstanceId: string;
    /** 今いる部屋が自分のホーム（ホームを押しても新しく作らない） */
    isHome: boolean;
    onClose: () => void;
}) {
    const navigate = useNavigate();
    const confirm = useConfirm();
    const { leaveWorld, users, currentUser } = useSocket();
    const [goingHome, setGoingHome] = useState(false);
    const othersHere = [...users.keys()].some((id) => id !== currentUser?.id);

    const moveTo = useCallback(
        async (instanceId: string, state: InstanceEntryState) => {
            await leaveWorld();
            navigate(`/instance/${instanceId}`, { state });
            onClose();
        },
        [leaveWorld, navigate, onClose],
    );

    const joinInstance = useCallback<JoinInstanceHandler>(
        async (instanceId, worldId, worldData) => {
            if (instanceId === currentInstanceId) {
                onClose();
                return;
            }
            if (!(await confirm('このインスタンスに移動しますか？現在のインスタンスから退出します。'))) return;
            await moveTo(instanceId, { worldId, worldData });
        },
        [confirm, currentInstanceId, moveTo, onClose],
    );

    const goHome = useCallback(async () => {
        if (goingHome) return;
        if (isHome) {
            pushToast('いまホームにいます');
            return;
        }
        // ひとりなら確認しない。ほかの人がいるときだけ、うっかり抜けないよう確かめる
        if (othersHere && !(await confirm('ホームに移動しますか？現在のインスタンスから退出します。'))) return;
        setGoingHome(true);
        try {
            const response = await ensureHomeInstance();
            await moveTo(response.instance.id, homeInstanceEntry(response));
        } catch (e: unknown) {
            pushToast(e instanceof Error ? e.message : 'ホームに移動できません', 'error');
        } finally {
            setGoingHome(false);
        }
    }, [confirm, goingHome, isHome, moveTo, othersHere]);

    const copyInvite = useCallback(async () => {
        try {
            await navigator.clipboard.writeText(instanceInviteUrl(window.location.origin, currentInstanceId));
            pushToast('招待の URL をコピーしました');
        } catch {
            pushToast('コピーできませんでした', 'error');
        }
    }, [currentInstanceId]);

    return { joinInstance, goHome, goingHome, copyInvite };
}
