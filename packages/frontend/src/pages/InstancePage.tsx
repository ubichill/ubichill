import { useSocket, useWorld } from '@ubichill/sdk/react';
import type { Instance } from '@ubichill/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { InstanceHUD } from '@/components/hud/InstanceHUD';
import { InstanceRenderer, type WorkerLoadState } from '@/instance/InstanceRenderer';
import { API_BASE } from '@/lib/api';
import { useSession } from '@/lib/auth-client';
import { PluginRegistryProvider } from '@/plugins/PluginRegistryContext';
import { css } from '@/styled-system/css';

type InstanceRouteState = {
    worldId?: string;
    worldName?: string;
    worldThumbnail?: string;
} | null;

type LoadingWorld = {
    id: string;
    displayName: string;
    thumbnail?: string;
};

const EMPTY_WORKER_LOAD_STATE: WorkerLoadState = {
    required: 0,
    ready: 0,
    snapshotRevision: 0,
};

export function InstancePage() {
    const navigate = useNavigate();
    const location = useLocation();
    const { id } = useParams<{ id: string }>();
    const { data: session, isPending } = useSession();

    const { isConnected, error, joinWorld, leaveWorld } = useSocket();
    const { resetWorld, hasSnapshot, snapshotRevision } = useWorld();

    const [loadingWorld, setLoadingWorld] = useState<LoadingWorld | null>(null);
    const [joinAcknowledged, setJoinAcknowledged] = useState(false);
    const [transitionStartRevision, setTransitionStartRevision] = useState(0);
    const [workerLoadState, setWorkerLoadState] = useState<WorkerLoadState>(EMPTY_WORKER_LOAD_STATE);
    const [timedOut, setTimedOut] = useState(false);

    const snapshotRevisionRef = useRef(snapshotRevision);
    snapshotRevisionRef.current = snapshotRevision;
    const leaveWorldRef = useRef(leaveWorld);
    leaveWorldRef.current = leaveWorld;
    const resetWorldRef = useRef(resetWorld);
    resetWorldRef.current = resetWorld;

    useEffect(() => {
        return () => {
            leaveWorldRef.current();
            resetWorldRef.current();
        };
    }, []);

    useEffect(() => {
        if (isPending) return;

        if (!session) {
            navigate('/auth');
            return;
        }

        if (!id) return;

        let cancelled = false;

        const routeState = location.state as InstanceRouteState;
        const startRevision = snapshotRevisionRef.current;

        const onJoinError = () => navigate('/');

        const doJoin = (world: LoadingWorld) => {
            if (cancelled) return;

            setLoadingWorld(world);
            setJoinAcknowledged(false);
            setTransitionStartRevision(startRevision);
            setWorkerLoadState({ ...EMPTY_WORKER_LOAD_STATE, snapshotRevision: startRevision });
            setTimedOut(false);

            leaveWorldRef.current();
            resetWorldRef.current();

            joinWorld(session.user.name, world.id, id, onJoinError, () => {
                if (!cancelled) {
                    setJoinAcknowledged(true);
                }
            });
        };

        // ロビーから来た場合は state に表示メタデータが入っている。直接 URL 時は API から解決する。
        if (routeState?.worldId && routeState.worldName) {
            doJoin({
                id: routeState.worldId,
                displayName: routeState.worldName,
                thumbnail: routeState.worldThumbnail,
            });
            return () => {
                cancelled = true;
            };
        }

        fetch(`${API_BASE}/api/v1/instances/${id}`, { credentials: 'include' })
            .then((r) => (r.ok ? (r.json() as Promise<Instance>) : null))
            .then((instance) => {
                if (cancelled) return;
                const worldId = instance?.world?.id;
                if (!worldId) {
                    navigate('/');
                    return;
                }
                doJoin({
                    id: worldId,
                    displayName: instance.world.displayName,
                    thumbnail: instance.world.thumbnail,
                });
            })
            .catch(() => navigate('/'));

        return () => {
            cancelled = true;
        };
    }, [session, isPending, navigate, id, location.state, joinWorld]);

    const handleWorkerLoadStateChange = useCallback((state: WorkerLoadState) => {
        setWorkerLoadState(state);
    }, []);

    const workersReady =
        workerLoadState.snapshotRevision === snapshotRevision && workerLoadState.ready >= workerLoadState.required;
    const loadingComplete =
        joinAcknowledged && hasSnapshot && snapshotRevision > transitionStartRevision && workersReady;
    const showLoading = isPending || !loadingWorld || !loadingComplete || timedOut;

    useEffect(() => {
        if (!loadingWorld || loadingComplete) return;
        const timeoutId = window.setTimeout(() => {
            setTimedOut(true);
        }, 10_000);
        return () => window.clearTimeout(timeoutId);
    }, [loadingWorld, loadingComplete]);

    if (error && !isConnected) {
        return (
            <div
                className={css({
                    minH: '100vh',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexDir: 'column',
                    gap: 4,
                })}
            >
                <p className={css({ color: 'red.500' })}>{error}</p>
                <button
                    type="button"
                    onClick={() => navigate('/')}
                    className={css({ padding: '8px 16px', bg: 'gray.200', rounded: 'md' })}
                >
                    ロビーへ
                </button>
            </div>
        );
    }

    return (
        <main>
            <PluginRegistryProvider>
                <InstanceRenderer onWorkerLoadStateChange={handleWorkerLoadStateChange} />
            </PluginRegistryProvider>
            {!showLoading && <InstanceHUD />}
            {showLoading && (
                <WorldLoadingScreen
                    world={loadingWorld}
                    timedOut={timedOut}
                    onBackToLobby={() => navigate('/')}
                    workerLoadState={workerLoadState}
                />
            )}
        </main>
    );
}

function WorldLoadingScreen({
    world,
    timedOut,
    onBackToLobby,
    workerLoadState,
}: {
    world: LoadingWorld | null;
    timedOut: boolean;
    onBackToLobby: () => void;
    workerLoadState: WorkerLoadState;
}) {
    const progress =
        workerLoadState.required > 0
            ? Math.min(100, Math.round((workerLoadState.ready / workerLoadState.required) * 100))
            : 100;

    return (
        <div
            className={css({
                position: 'fixed',
                inset: 0,
                zIndex: 30000,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                bg: 'rgba(8, 11, 18, 0.92)',
                color: 'white',
                backdropFilter: 'blur(10px)',
            })}
        >
            <style>
                {`
@keyframes ubichill-world-loading {
  0% { transform: translateX(140%); }
  100% { transform: translateX(-240%); }
}
`}
            </style>
            <div
                className={css({
                    width: 'min(420px, calc(100vw - 48px))',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '18px',
                })}
            >
                <div
                    className={css({
                        width: '100%',
                        aspectRatio: '16 / 9',
                        overflow: 'hidden',
                        borderRadius: '8px',
                        bg: 'rgba(255, 255, 255, 0.12)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                    })}
                >
                    {world?.thumbnail ? (
                        <img
                            src={world.thumbnail}
                            alt=""
                            className={css({ width: '100%', height: '100%', objectFit: 'cover' })}
                        />
                    ) : (
                        <span className={css({ fontSize: '13px', color: 'rgba(255, 255, 255, 0.58)' })}>
                            No thumbnail
                        </span>
                    )}
                </div>
                <div
                    className={css({
                        width: '100%',
                        textAlign: 'center',
                        fontSize: { base: '18px', md: '22px' },
                        fontWeight: '700',
                        lineHeight: 1.25,
                        overflowWrap: 'anywhere',
                    })}
                >
                    {world?.displayName ?? 'ワールド'}
                </div>
                <div
                    className={css({
                        width: '100%',
                        height: '8px',
                        borderRadius: '999px',
                        bg: 'rgba(255, 255, 255, 0.16)',
                        overflow: 'hidden',
                        position: 'relative',
                    })}
                    role="progressbar"
                    aria-label="ワールド読み込み"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={progress}
                >
                    <div
                        className={css({
                            position: 'absolute',
                            top: 0,
                            right: 0,
                            width: '46%',
                            height: '100%',
                            borderRadius: '999px',
                            bg: timedOut ? '#ff6b6b' : '#8ad29b',
                        })}
                        style={{
                            animation: timedOut ? undefined : 'ubichill-world-loading 1.05s linear infinite',
                        }}
                    />
                </div>
                {timedOut && (
                    <div
                        className={css({ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' })}
                    >
                        <p className={css({ fontSize: '14px', color: 'rgba(255, 255, 255, 0.76)' })}>
                            ワールドの読み込みがタイムアウトしました。
                        </p>
                        <button
                            type="button"
                            onClick={onBackToLobby}
                            className={css({
                                px: '16px',
                                py: '9px',
                                borderRadius: '8px',
                                border: '1px solid rgba(255, 255, 255, 0.28)',
                                bg: 'rgba(255, 255, 255, 0.12)',
                                color: 'white',
                                cursor: 'pointer',
                                fontSize: '14px',
                                fontWeight: '600',
                                _hover: { bg: 'rgba(255, 255, 255, 0.18)' },
                            })}
                        >
                            ロビーへ戻る
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
