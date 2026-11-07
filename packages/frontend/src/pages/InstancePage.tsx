import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';
import { InstanceHUD } from '@/components/hud/InstanceHUD';
import { useConfirm } from '@/components/ui/ConfirmProvider';
import type { HomeEntryState, InstanceEntryState } from '@/lib/home';
import { fetchInstance } from '@/lib/instancesApi';
import { HOST_MOD_SOURCE } from '@/lib/modCdn';
import { useSession } from '@/lib/session';
import { pushToast } from '@/lib/toast';
import { WorldView } from '@/world';

/** 失敗したら一定時間後に自動でホームへ戻す（ロード画面で詰まらないように）。 */
const RETURN_HOME_MS = 5000;

/**
 * SNS のインスタンス画面。ワールドを動かすのは `WorldView` で、ここは認証の確認・ホームへの導線・HUD を足すだけ。
 * ホーム・共有 URL・他人のインスタンスなど入口は複数あるが、必ずここを通る。
 */
export function InstancePage() {
    const navigate = useNavigate();
    const location = useLocation();
    const { id } = useParams<{ id: string }>();
    const { data: session, isPending } = useSession();
    const confirm = useConfirm();

    useEffect(() => {
        if (!isPending && !session) navigate('/auth');
    }, [isPending, session, navigate]);

    // どの部屋で失敗したかを渡す。ホームの部屋そのものが壊れていても、ホーム ⇄ 失敗を繰り返さない
    const toHome = useCallback(() => {
        const state: HomeEntryState = id ? { homeFailed: id } : {};
        navigate('/', { state });
    }, [id, navigate]);
    const [failure, setFailure] = useState<string | null>(null);
    useEffect(() => {
        if (!failure) return;
        console.warn('[InstancePage] load failed → returning home:', failure);
        const timer = setTimeout(toHome, RETURN_HOME_MS);
        return () => clearTimeout(timer);
    }, [failure, toHome]);

    const notice = (location.state as InstanceEntryState | null)?.notice;
    useEffect(() => {
        if (notice) pushToast(notice, 'warn');
    }, [notice]);

    const userName = session?.user.name ?? new URLSearchParams(location.search).get('name') ?? 'Guest';
    const stateWorldData = (location.state as InstanceEntryState | null)?.worldData;
    const preview = useMemo(
        () => ({ displayName: stateWorldData?.displayName, thumbnail: stateWorldData?.thumbnail }),
        [stateWorldData?.displayName, stateWorldData?.thumbnail],
    );
    const recovery = useMemo(() => ({ label: 'ホームに戻る', run: toHome }), [toHome]);

    if (!id) return null;
    return (
        <WorldView
            instanceId={id}
            userName={userName}
            fetchInstance={fetchInstance}
            confirmEntry={confirm}
            modSource={HOST_MOD_SOURCE}
            authPending={isPending}
            selfId={session?.user?.id}
            preview={preview}
            recovery={recovery}
            onFailed={setFailure}
        >
            <InstanceHUD />
        </WorldView>
    );
}
