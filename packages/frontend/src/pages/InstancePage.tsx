import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';
import { InstanceHUD } from '@/components/hud/InstanceHUD';
import { useConfirm } from '@/components/ui/ConfirmProvider';
import { fetchInstance } from '@/lib/instancesApi';
import { HOST_MOD_SOURCE } from '@/lib/modCdn';
import { useSession } from '@/lib/session';
import { WorldView } from '@/world';

/** 失敗したら一定時間後に自動でロビーへ戻す（ロード画面で詰まらないように）。 */
const RETURN_TO_LOBBY_MS = 5000;

/**
 * SNS のインスタンス画面。ワールドを動かすのは `WorldView` で、ここは認証の確認・ロビーへの導線・HUD を足すだけ。
 * ロビー・共有 URL・他人のインスタンスなど入口は複数あるが、必ずここを通る。
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

    const toLobby = useCallback(() => navigate('/'), [navigate]);
    const [failure, setFailure] = useState<string | null>(null);
    useEffect(() => {
        if (!failure) return;
        console.warn('[InstancePage] load failed → returning to lobby:', failure);
        const timer = setTimeout(toLobby, RETURN_TO_LOBBY_MS);
        return () => clearTimeout(timer);
    }, [failure, toLobby]);

    const userName = session?.user.name ?? new URLSearchParams(location.search).get('name') ?? 'Guest';
    const stateWorldData = (location.state as { worldData?: { thumbnail?: string; displayName?: string } } | null)
        ?.worldData;
    const preview = useMemo(
        () => ({ displayName: stateWorldData?.displayName, thumbnail: stateWorldData?.thumbnail }),
        [stateWorldData?.displayName, stateWorldData?.thumbnail],
    );
    const recovery = useMemo(() => ({ label: 'ロビーに戻る', run: toLobby }), [toLobby]);

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
