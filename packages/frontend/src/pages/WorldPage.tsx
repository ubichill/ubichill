import { useSocket, useWorld } from '@ubichill/sdk/react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useInstances } from '@/core/hooks/useInstances';
import { InstanceRenderer } from '@/instance/InstanceRenderer';
import { useSession } from '@/lib/auth-client';
import { PluginRegistryProvider } from '@/plugins/PluginRegistryContext';
import { css } from '@/styled-system/css';

type PageState = 'loading' | 'joining' | 'connected' | 'error';

/**
 * 公開ワールド URL (/world/:worldId)
 * - 未認証: /auth にリダイレクトし、認証後このページに戻ってくる
 * - 認証済み: ワールドに紐づくインスタンスを自動作成して参加
 */
export function WorldPage() {
    const navigate = useNavigate();
    const { worldId } = useParams<{ worldId: string }>();
    const { data: session, isPending } = useSession();

    const { isConnected, error: socketError, joinWorld, leaveWorld } = useSocket();
    const { environment } = useWorld();
    const { createInstance } = useInstances();

    const [pageState, setPageState] = useState<PageState>('loading');
    const [errorMessage, setErrorMessage] = useState('');
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
            // 認証後にこのページに戻れるよう state に保存してリダイレクト
            navigate('/auth', { state: { from: { pathname: `/world/${worldId}` } }, replace: true });
            return;
        }

        if (hasJoinedRef.current) return;
        if (!worldId) {
            setErrorMessage('ワールドIDが見つかりません');
            setPageState('error');
            return;
        }

        hasJoinedRef.current = true;
        setPageState('joining');

        (async () => {
            const instance = await createInstance({ worldId });
            if (!instance) {
                setErrorMessage('インスタンスの作成に失敗しました');
                setPageState('error');
                return;
            }

            joinWorld(session.user.name, worldId, instance.id, (err) => {
                setErrorMessage(err);
                setPageState('error');
            });
        })();
    }, [session, isPending, navigate, worldId, createInstance, joinWorld]);

    useEffect(() => {
        if (isConnected && pageState === 'joining') {
            setPageState('connected');
        }
    }, [isConnected, pageState]);

    if (pageState === 'loading' || pageState === 'joining') {
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
                <p>ワールドに接続中...</p>
            </div>
        );
    }

    if (pageState === 'error' || (socketError && !isConnected)) {
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
                <p className={css({ color: 'red.500' })}>{errorMessage || socketError}</p>
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
