import { useSocket, useWorld, WorkerLoadingProvider } from '@ubichill/react';
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';
import { InstanceHUD } from '@/components/hud/InstanceHUD';
import { useConfirm } from '@/components/ui/ConfirmProvider';
import { InstanceLoadingScreen } from '@/instance/InstanceLoadingScreen';
import { InstanceRenderer } from '@/instance/InstanceRenderer';
import { useInstanceLoading } from '@/instance/useInstanceLoading';
import { fetchInstance } from '@/lib/instancesApi';
import { useSession } from '@/lib/session';
import { acceptEntry, hasAcceptedEntry, unverifiedEntryKey, unverifiedEntryMessage } from '@/lib/signing';
import { ModRegistryProvider } from '@/mods/ModRegistryContext';

export function InstancePage() {
    const navigate = useNavigate();
    const location = useLocation();
    const { id } = useParams<{ id: string }>();
    const { data: session, isPending } = useSession();
    const confirm = useConfirm();

    const { isConnected, error, currentUser, joinWorld, leaveWorld } = useSocket();
    const { resetWorld, modLock, worldSourceKind } = useWorld();

    const joinedIdRef = useRef<string | null>(null);
    const leaveWorldRef = useRef(leaveWorld);
    leaveWorldRef.current = leaveWorld;

    // ワールドID解決の失敗など、Socket 以外で起きるロードエラー
    const [loadError, setLoadError] = useState<string | null>(null);

    // mod DL / ワーカー起動の進捗（各 Provider から通知される）
    const [mods, setMods] = useState({ completed: 0, total: 0 });
    const [workers, setWorkers] = useState({ ready: 0, total: 0 });

    useEffect(() => {
        return () => {
            // 確認待ちの入室処理があれば打ち切る（stillTarget が false になる）
            joinedIdRef.current = null;
            leaveWorldRef.current();
            resetWorld();
        };
    }, [resetWorld]);

    useEffect(() => {
        if (isPending) return;

        if (!session) {
            navigate('/auth');
            return;
        }

        if (!id) return;
        if (joinedIdRef.current === id) return;

        // 対象 id を同期的に確保する。以降の await 中に別 id へ移動・アンマウントされたら
        // joinedIdRef が変わるので、それを見て古い入室処理を打ち切る（確認待ちでも二重入室しない）。
        const previousId = joinedIdRef.current;
        joinedIdRef.current = id;
        const stillTarget = () => joinedIdRef.current === id;

        const connectToNewInstance = async () => {
            // 旧インスタンスからの退出完了を待ってから join する（レースコンディション防止）
            if (previousId) {
                await leaveWorldRef.current();
                resetWorld();
            }
            if (!stillTarget()) return;

            // ロビー・共有 URL・他人のインスタンスなど入口は複数あるが、必ずここを通る。
            // 作者署名を検証できないワールドは、入室（= mod 実行）前に本人の確認を取る。
            const instance = await fetchInstance(id).catch(() => null);
            if (!stillTarget()) return;
            const entryKey = instance ? unverifiedEntryKey(instance.world) : null;
            if (instance && entryKey && !hasAcceptedEntry(sessionStorage, entryKey)) {
                const accepted = await confirm(unverifiedEntryMessage(instance.world));
                if (!stillTarget()) return;
                if (!accepted) {
                    joinedIdRef.current = null;
                    navigate('/');
                    return;
                }
                acceptEntry(sessionStorage, entryKey);
            }
            if (!stillTarget()) return;
            setLoadError(null);

            // ワールドは backend が instanceId -> DB worldRef から権威的に解決する。
            // location.state や API 応答の短い worldId を使うと、外部 YAML の URL/lock が失われる。
            joinWorld(session.user.name, id, (msg) => {
                console.error('[InstancePage] world:join failed:', msg);
            });
        };

        void connectToNewInstance();
    }, [session, isPending, navigate, id, joinWorld, resetWorld, confirm]);

    const loading = useInstanceLoading({
        instanceId: id,
        isAuthPending: isPending,
        isConnected,
        isJoined: currentUser != null,
        error: error ?? loadError,
        mods,
        workers,
    });

    // 失敗時は一定時間後に自動でロビーへ戻す（ロード画面で詰まらないように）
    useEffect(() => {
        if (!loading.failed) return;
        console.warn('[InstancePage] load failed → returning to lobby:', loading.failureMessage);
        const timer = setTimeout(() => navigate('/'), 5000);
        return () => clearTimeout(timer);
    }, [loading.failed, loading.failureMessage, navigate]);

    const stateWorldData = (location.state as { worldData?: { thumbnail?: string; displayName?: string } } | null)
        ?.worldData;

    return (
        <>
            {loading.showScreen && (
                <InstanceLoadingScreen
                    worldName={stateWorldData?.displayName}
                    thumbnail={stateWorldData?.thumbnail}
                    progress={loading.progress}
                    stages={loading.stages}
                    fadingOut={loading.fadingOut}
                    failed={loading.failed}
                    failureMessage={loading.failureMessage}
                    onReturnToLobby={() => navigate('/')}
                />
            )}
            {!loading.failed && currentUser != null && (
                <main>
                    <ModRegistryProvider key={id} onStatusChange={setMods} lock={modLock} sourceKind={worldSourceKind}>
                        <WorkerLoadingProvider onStatusChange={setWorkers}>
                            <InstanceRenderer />
                        </WorkerLoadingProvider>
                    </ModRegistryProvider>
                    <InstanceHUD />
                </main>
            )}
        </>
    );
}
