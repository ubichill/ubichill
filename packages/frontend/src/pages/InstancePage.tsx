import { useSocket } from '@ubichill/sdk/react';
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { InstanceHUD } from '@/components/hud/InstanceHUD';
import { InstanceRenderer } from '@/instance/InstanceRenderer';
import { API_BASE } from '@/lib/api';
import { useSession } from '@/lib/auth-client';
import { PluginRegistryProvider } from '@/plugins/PluginRegistryContext';
import { css } from '@/styled-system/css';

export function InstancePage() {
    const navigate = useNavigate();
    const location = useLocation();
    const { id } = useParams<{ id: string }>();
    const { data: session, isPending } = useSession();

    const { isConnected, error, joinWorld, leaveWorld } = useSocket();

    const [connecting, setConnecting] = useState(true);
    const joinedIdRef = useRef<string | null>(null);
    const leaveWorldRef = useRef(leaveWorld);
    leaveWorldRef.current = leaveWorld;

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

        if (joinedIdRef.current) {
            leaveWorldRef.current();
            setConnecting(true);
        }

        joinedIdRef.current = id;

        const onJoinError = () => navigate('/');

        const doJoin = (worldId: string) => {
            joinWorld(session.user.name, worldId, id, onJoinError);
            setConnecting(false);
        };

        // ロビーから来た場合は state に worldId が入っている。直接 URL 時は API から解決する
        const stateWorldId = (location.state as { worldId?: string } | null)?.worldId;
        if (stateWorldId) {
            doJoin(stateWorldId);
            return;
        }

        let cancelled = false;
        fetch(`${API_BASE}/api/v1/instances/${id}`, { credentials: 'include' })
            .then((r) => (r.ok ? r.json() : null))
            .then((instance) => {
                if (cancelled) return;
                const worldId = instance?.world?.id;
                if (!worldId) {
                    navigate('/');
                    return;
                }
                doJoin(worldId);
            })
            .catch(() => {
                if (!cancelled) navigate('/');
            });

        return () => {
            cancelled = true;
        };
    }, [session, isPending, navigate, id, location.state, joinWorld]);

    if (isPending || connecting) {
        const stateWorldData = (location.state as { worldData?: { thumbnail?: string; displayName?: string } } | null)?.worldData;

        return (
            <div
                className={css({
                    minH: '100vh',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: 'primary',
                    color: 'white',
                    gap: '24px',
                })}
            >
                {stateWorldData?.thumbnail ? (
                    <img
                        src={stateWorldData.thumbnail}
                        alt="Thumbnail"
                        className={css({
                            width: '160px',
                            height: '160px',
                            objectFit: 'cover',
                            borderRadius: '24px',
                            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
                        })}
                    />
                ) : (
                    <div
                        className={css({
                            width: '160px',
                            height: '160px',
                            borderRadius: '24px',
                            backgroundColor: 'rgba(255, 255, 255, 0.1)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                        })}
                    >
                        <span className={css({ color: 'rgba(255, 255, 255, 0.5)' })}>Loading...</span>
                    </div>
                )}
                
                <h2
                    className={css({
                        fontSize: '24px',
                        fontWeight: 'bold',
                        letterSpacing: '0.05em',
                    })}
                >
                    {stateWorldData?.displayName || '接続中...'}
                </h2>

                <div
                    className={css({
                        width: '240px',
                        height: '4px',
                        backgroundColor: 'rgba(255, 255, 255, 0.2)',
                        borderRadius: 'full',
                        overflow: 'hidden',
                        position: 'relative',
                    })}
                >
                    <div
                        className={css({
                            position: 'absolute',
                            top: 0,
                            bottom: 0,
                            left: 0,
                            width: '50%',
                            backgroundColor: 'white',
                            borderRadius: 'full',
                            animation: 'progress 1.5s infinite ease-in-out',
                        })}
                    />
                </div>
            </div>
        );
    }

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
                <InstanceRenderer />
            </PluginRegistryProvider>
            <InstanceHUD />
        </main>
    );
}
