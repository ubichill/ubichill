import { useSocket, useWorld, WorkerLoadingProvider } from '@ubichill/react';
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';
import { InstanceHUD } from '@/components/hud/InstanceHUD';
import { InstanceLoadingScreen } from '@/instance/InstanceLoadingScreen';
import { InstanceRenderer } from '@/instance/InstanceRenderer';
import { useInstanceLoading } from '@/instance/useInstanceLoading';
import { useSession } from '@/lib/session';
import { ModRegistryProvider } from '@/mods/ModRegistryContext';

export function InstancePage() {
    const navigate = useNavigate();
    const location = useLocation();
    const { id } = useParams<{ id: string }>();
    const { data: session, isPending } = useSession();

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

        let cancelled = false;

        // 旧インスタンスからの退出完了を待ってから join する（レースコンディション防止）
        const connectToNewInstance = async () => {
            if (joinedIdRef.current) {
                await leaveWorldRef.current();
                resetWorld();
            }
            if (cancelled) return;

            joinedIdRef.current = id;
            setLoadError(null);

            // ワールドは backend が instanceId -> DB worldRef から権威的に解決する。
            // location.state や API 応答の短い worldId を使うと、外部 YAML の URL/lock が失われる。
            joinWorld(session.user.name, id, (msg) => {
                console.error('[InstancePage] world:join failed:', msg);
            });
        };

        void connectToNewInstance();

        return () => {
            cancelled = true;
        };
    }, [session, isPending, navigate, id, joinWorld, resetWorld]);

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
