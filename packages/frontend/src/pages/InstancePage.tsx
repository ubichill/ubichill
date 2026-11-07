import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';
import { InstanceHUD } from '@/components/hud/InstanceHUD';
import { useConfirm } from '@/components/ui/ConfirmProvider';
import { afterInstanceFailure, readInstanceEntryState } from '@/lib/home';
import { fetchInstance } from '@/lib/instancesApi';
import { HOST_MOD_SOURCE } from '@/lib/modCdn';
import { useSession } from '@/lib/session';
import { pushToast } from '@/lib/toast';
import { useRemoteVisit } from '@/lib/useRemoteVisit';
import { WorldView } from '@/world';
import type { InstanceFailure } from '@/world/WorldView';

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

    // 部屋を移ってもこのページは作り直されないので、入った部屋ごとに読む
    const entry = useMemo(() => readInstanceEntryState(location.state), [location.state]);
    const [failed, setFailed] = useState<{ instanceId: string; failure: InstanceFailure } | null>(null);
    const failure = failed && failed.instanceId === id ? failed.failure : null;
    const handleFailed = useCallback(
        (next: InstanceFailure) => {
            if (id) setFailed({ instanceId: id, failure: next });
        },
        [id],
    );
    const toHome = useCallback(() => {
        const next = afterInstanceFailure(failure ?? { replaced: false }, entry);
        navigate('/', { state: next.kind === 'home' ? next.state : {} });
    }, [entry, failure, navigate]);
    useEffect(() => {
        if (!failure || afterInstanceFailure(failure, entry).kind === 'stay') return;
        console.warn('[InstancePage] load failed → returning home:', failure.message);
        const timer = setTimeout(toHome, RETURN_HOME_MS);
        return () => clearTimeout(timer);
    }, [entry, failure, toHome]);

    // お知らせは 1 度だけ（読み込み直しで履歴の state からまた出さない）
    useEffect(() => {
        if (!entry.notice) return;
        pushToast(entry.notice, 'warn');
        navigate(location.pathname, { replace: true, state: { ...entry, notice: undefined } });
    }, [entry, location.pathname, navigate]);

    // ほかのサーバーの部屋にいる間は、ホームに来訪を知らせ続ける
    useRemoteVisit(id, !failure);

    const userName = session?.user.name ?? new URLSearchParams(location.search).get('name') ?? 'Guest';
    const preview = useMemo(
        () => ({ displayName: entry.worldData?.displayName, thumbnail: entry.worldData?.thumbnail }),
        [entry.worldData?.displayName, entry.worldData?.thumbnail],
    );
    // 別のタブに切られたときは、ここで入り直すかを本人が選ぶ（自動で戻すとタブ同士で取り合う）
    const recovery = useMemo(
        () =>
            failure?.replaced
                ? { label: 'このタブで入り直す', run: () => window.location.reload() }
                : { label: 'ホームに戻る', run: toHome },
        [failure?.replaced, toHome],
    );

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
            onFailed={handleFailed}
        >
            <InstanceHUD />
        </WorldView>
    );
}
