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
    const hasJoinedRef = useRef(false);
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

        if (hasJoinedRef.current) return;
        if (!id) return;

        hasJoinedRef.current = true;

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
        fetch(`${API_BASE}/api/v1/instances/${id}`, { credentials: 'include' })
            .then((r) => (r.ok ? r.json() : null))
            .then((instance) => {
                const worldId = instance?.world?.id;
                if (!worldId) {
                    navigate('/');
                    return;
                }
                doJoin(worldId);
            })
            .catch(() => navigate('/'));
    }, [session, isPending, navigate, id, location.state, joinWorld]);

    if (isPending || connecting) {
        return (
            <div className={css({ minH: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' })}>
                <p>接続中...</p>
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
