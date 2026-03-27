import { useSocket, useWorld } from '@ubichill/sdk/react';
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
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
    const { environment } = useWorld();

    const [connecting, setConnecting] = useState(true);
    const hasJoinedRef = useRef(false);
    // leaveWorld を ref で保持してクリーンアップ effect の再実行を防ぐ
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

        // ロビーから来た場合は state に worldId が入っている
        const stateWorldId = (location.state as { worldId?: string } | null)?.worldId;

        const doJoin = (worldId: string) => {
            joinWorld(session.user.name, worldId, id, onJoinError);
            setConnecting(false);
        };

        if (stateWorldId) {
            doJoin(stateWorldId);
        } else {
            // 直接 URL アクセス: API からインスタンス情報を取得して worldId を解決
            fetch(`${API_BASE}/api/v1/instances/${id}`, { credentials: 'include' })
                .then((r) => r.json())
                .then((instance) => {
                    const worldId = instance?.world?.id ?? instance?.worldId;
                    if (!worldId) {
                        navigate('/');
                        return;
                    }
                    doJoin(worldId);
                })
                .catch(() => navigate('/'));
        }
    }, [session, isPending, navigate, id, location.state, joinWorld]);

    if (isPending || connecting) {
        return (
            <div className={css({ minH: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' })}>
                <p>接続中...</p>
            </div>
        );
    }

    // ソケット接続自体が切れた場合のみエラー表示（join エラーは onJoinError でリダイレクト済み）
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
                    戻る
                </button>
            </div>
        );
    }

    return (
        <main
            style={{
                width: '100vw',
                height: '100vh',
                position: 'relative',
                overflow: 'hidden',
                backgroundColor: environment?.backgroundColor || '#f8f9fa',
                backgroundImage: environment?.backgroundImage ? `url(${environment.backgroundImage})` : 'none',
                backgroundSize: 'cover',
                backgroundPosition: 'center',
            }}
        >
            <PluginRegistryProvider>
                <InstanceRenderer />
            </PluginRegistryProvider>
        </main>
    );
}
