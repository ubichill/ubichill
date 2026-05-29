import { useSocket, WorkerLoadingProvider } from '@ubichill/react';
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';
import { InstanceHUD } from '@/components/hud/InstanceHUD';
import { InstanceLoadingScreen } from '@/instance/InstanceLoadingScreen';
import { InstanceRenderer } from '@/instance/InstanceRenderer';
import { useInstanceLoading } from '@/instance/useInstanceLoading';
import { API_BASE } from '@/lib/api';
import { useSession } from '@/lib/auth-client';
import { PluginRegistryProvider } from '@/plugins/PluginRegistryContext';

export function InstancePage() {
    const navigate = useNavigate();
    const location = useLocation();
    const { id } = useParams<{ id: string }>();
    const { data: session, isPending } = useSession();

    const { isConnected, error, currentUser, joinWorld, leaveWorld } = useSocket();

    const joinedIdRef = useRef<string | null>(null);
    const leaveWorldRef = useRef(leaveWorld);
    leaveWorldRef.current = leaveWorld;

    // ワールドID解決の失敗など、Socket 以外で起きるロードエラー
    const [loadError, setLoadError] = useState<string | null>(null);

    // プラグイン DL / ワーカー起動の進捗（各 Provider から通知される）
    const [plugins, setPlugins] = useState({ completed: 0, total: 0 });
    const [workers, setWorkers] = useState({ ready: 0, total: 0 });

    useEffect(() => {
        return () => {
            leaveWorldRef.current();
        };
    }, []);

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
            }
            if (cancelled) return;

            joinedIdRef.current = id;
            setLoadError(null);

            const doJoin = (worldId: string) => {
                joinWorld(session.user.name, worldId, id, (msg) => {
                    // join 失敗は useSocket 側で error にも反映される。ここではデバッグ用にログのみ。
                    console.error('[InstancePage] world:join failed:', msg);
                });
            };

            // ロビーから来た場合は state に worldId が入っている。直接 URL 時は API から解決する
            const stateWorldId = (location.state as { worldId?: string } | null)?.worldId;
            if (stateWorldId) {
                doJoin(stateWorldId);
                return;
            }

            try {
                const r = await fetch(`${API_BASE}/api/v1/instances/${id}`, { credentials: 'include' });
                const instance = r.ok ? await r.json() : null;
                if (cancelled) return;
                const worldId = instance?.world?.id;
                if (!worldId) {
                    setLoadError('インスタンスが見つかりませんでした');
                    return;
                }
                doJoin(worldId);
            } catch (e) {
                if (cancelled) return;
                console.error('[InstancePage] failed to resolve worldId:', e);
                setLoadError('ワールド情報の取得に失敗しました');
            }
        };

        void connectToNewInstance();

        return () => {
            cancelled = true;
        };
    }, [session, isPending, navigate, id, location.state, joinWorld]);

    const loading = useInstanceLoading({
        instanceId: id,
        isAuthPending: isPending,
        isConnected,
        isJoined: currentUser != null,
        error: error ?? loadError,
        plugins,
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
            <main>
                <PluginRegistryProvider key={id} onStatusChange={setPlugins}>
                    <WorkerLoadingProvider onStatusChange={setWorkers}>
                        <InstanceRenderer />
                    </WorkerLoadingProvider>
                </PluginRegistryProvider>
                <InstanceHUD />
            </main>
        </>
    );
}
