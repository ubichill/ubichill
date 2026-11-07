import { useSocket } from '@ubichill/react';
import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router';
import { useConfirm } from '@/components/ui/ConfirmProvider';
import { signOut } from '@/lib/auth-client';
import { FALLBACK_NOTICE, type InstanceEntryState, instanceEntryState, instanceInviteUrl } from '@/lib/home';
import { ensureHomeInstance } from '@/lib/homeApi';
import { resetHome } from '@/lib/homeStore';
import { pushToast } from '@/lib/toast';
import type { JoinInstanceHandler } from './tabs/shared';

/**
 * ランチパッドの操作（別の部屋へ移る・ホーム・リスポーン・招待のコピー・ログアウト）。
 * 部屋を移るときは、古い部屋から確実に抜けてから移る。
 */
export function useHudActions({ currentInstanceId, onClose }: { currentInstanceId: string; onClose: () => void }) {
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
        setGoingHome(true);
        try {
            const response = await ensureHomeInstance();
            if (response.instance.id === currentInstanceId) {
                pushToast('いまホームにいます');
                onClose();
                return;
            }
            // ひとりなら確認しない。ほかの人がいるときだけ、うっかり抜けないよう確かめる
            if (othersHere && !(await confirm('ホームに移動しますか？現在のインスタンスから退出します。'))) return;
            const notice = response.fallback === 'unresolvable' ? FALLBACK_NOTICE : undefined;
            await moveTo(response.instance.id, instanceEntryState(response.instance, notice));
        } catch (e: unknown) {
            pushToast(e instanceof Error ? e.message : 'ホームに移動できません', 'error');
        } finally {
            setGoingHome(false);
        }
    }, [confirm, currentInstanceId, goingHome, moveTo, onClose, othersHere]);

    /** 同じ部屋に入り直す（接続・mod・持ち物・乗り物をすべて最初の状態に戻す）。 */
    const respawn = useCallback(() => {
        // 入ったときのお知らせ（既定のワールドに切り替えた等）を読み込み直しでもう一度出さない
        window.history.replaceState(null, '', window.location.href);
        window.location.reload();
    }, []);

    const copyInvite = useCallback(async () => {
        try {
            await navigator.clipboard.writeText(instanceInviteUrl(window.location.origin, currentInstanceId));
            pushToast('招待の URL をコピーしました');
        } catch {
            pushToast('コピーできませんでした', 'error');
        }
    }, [currentInstanceId]);

    const logout = useCallback(async () => {
        if (!(await confirm('ログアウトしますか？'))) return;
        await leaveWorld();
        await signOut();
        resetHome();
        navigate('/auth');
    }, [confirm, leaveWorld, navigate]);

    return { joinInstance, goHome, goingHome, respawn, copyInvite, logout };
}
