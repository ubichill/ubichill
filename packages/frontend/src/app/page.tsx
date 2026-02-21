'use client';

import { PenTray } from '@ubichill/plugin-pen';
import { useSocket, useWorld } from '@ubichill/sdk';
import type { CursorState, UserStatus } from '@ubichill/shared';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Lobby } from '@/components/lobby';
import { UbichillOverlay } from '@/components/UbichillOverlay';
import { useCursorState } from '@/core/hooks/useCursorState';
import { signOut, useSession } from '@/lib/auth-client';
import { APP_PLUGINS } from '@/plugins/registry';
import * as styles from '@/styles/styles';

type AppScreen = 'lobby' | 'world';

export default function Home() {
    const router = useRouter();
    const { data: session, isPending } = useSession();
    const { isConnected, users, currentUser, error, joinWorld, updatePosition } = useSocket();
    const { environment } = useWorld();
    const [screen, setScreen] = useState<AppScreen>('lobby');

    // 認証チェック - ログインしていない場合はリダイレクト
    useEffect(() => {
        if (!isPending && !session) {
            router.push('/auth');
        }
    }, [session, isPending, router]);

    // ユーザー名はセッションから取得
    const userName = session?.user?.name || '';

    // 現在のカーソル状態を取得
    const cursorState: CursorState = useCursorState();

    // User status (busy = 作業中でカーソル固定)
    const [userStatus, setUserStatus] = useState<UserStatus>('online');
    const [cursorLockPosition, setCursorLockPosition] = useState<{ x: number; y: number } | null>(null);
    const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });

    // インスタンスに参加
    const handleJoinInstance = (instanceId: string, worldId: string) => {
        joinWorld(userName, worldId, instanceId);
        setScreen('world');
    };

    // ログアウト
    const handleLogout = async () => {
        await signOut();
        router.push('/auth');
    };

    // Add ref for the container
    const canvasRef = useRef<HTMLDivElement>(null);

    // Throttle cursor position updates
    const lastPositionUpdateRef = useRef({ x: 0, y: 0, state: 'default' as CursorState, time: 0 });
    const POSITION_UPDATE_THROTTLE = 50; // ms

    const handleMouseMove = (e: React.MouseEvent) => {
        // マウス位置を追跡（AppPluginに渡すため）
        setMousePosition({ x: e.clientX, y: e.clientY });

        if (screen === 'world' && canvasRef.current) {
            const rect = canvasRef.current.getBoundingClientRect();
            let x = e.clientX - rect.left;
            let y = e.clientY - rect.top;

            // 作業中ステータスの場合は、カーソルをロックした位置に固定
            if (userStatus === 'busy' && cursorLockPosition) {
                x = cursorLockPosition.x;
                y = cursorLockPosition.y;
            }

            // Throttle updates to reduce socket traffic
            const now = Date.now();
            const lastUpdate = lastPositionUpdateRef.current;
            const timeSinceLastUpdate = now - lastUpdate.time;
            const positionChanged = x !== lastUpdate.x || y !== lastUpdate.y;
            const stateChanged = cursorState !== lastUpdate.state;

            if ((positionChanged || stateChanged) && timeSinceLastUpdate >= POSITION_UPDATE_THROTTLE) {
                updatePosition({ x, y }, cursorState);
                lastPositionUpdateRef.current = { x, y, state: cursorState, time: now };
            }
        }
    };

    // 右クリックハンドラー: 自分のカーソル上で右クリックするとRadialMenuを表示
    const handleContextMenu = useCallback((e: React.MouseEvent) => {
        // デフォルトのコンテキストメニューを無効化
        e.preventDefault();
    }, []);

    // ステータス変更
    const handleStatusChange = useCallback(
        (status: UserStatus) => {
            setUserStatus(status);

            if (status === 'busy' && canvasRef.current) {
                // 作業中: カーソルの現在位置をロック
                const rect = canvasRef.current.getBoundingClientRect();
                const x = mousePosition.x - rect.left;
                const y = mousePosition.y - rect.top;
                setCursorLockPosition({ x, y });
            } else {
                // その他のステータス: ロック解除
                setCursorLockPosition(null);
            }
        },
        [mousePosition],
    );

    // ローディング中または未認証の場合
    if (isPending || !session) {
        return (
            <main className={styles.mainContainer}>
                <div className={styles.loginContainer}>
                    <h1 className={styles.title}>Ubichill</h1>
                    <p style={{ color: '#868e96', marginBottom: '24px', fontSize: '14px' }}>読み込み中...</p>
                </div>
            </main>
        );
    }

    // ロビー画面
    if (screen === 'lobby') {
        return (
            <main className={styles.mainContainer}>
                <div className={styles.headerContainer}>
                    <p className={styles.statusBar}>
                        ステータス: {isConnected ? '接続済み' : '切断'}
                        {error && <span className={styles.errorText}>{error}</span>}
                    </p>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <span style={{ color: '#495057', fontSize: '14px' }}>{userName}</span>
                        <button
                            type="button"
                            onClick={handleLogout}
                            style={{
                                padding: '8px 16px',
                                backgroundColor: 'transparent',
                                color: '#868e96',
                                border: '1px solid #dee2e6',
                                borderRadius: '6px',
                                fontSize: '13px',
                                cursor: 'pointer',
                            }}
                        >
                            ログアウト
                        </button>
                    </div>
                </div>

                <Lobby userName={userName} onJoinInstance={handleJoinInstance} />
            </main>
        );
    }

    // ワールド画面
    return (
        <main
            className={styles.mainContainer}
            onMouseMove={handleMouseMove}
            onContextMenu={handleContextMenu}
            style={{
                backgroundColor: environment.backgroundColor,
                backgroundImage: environment.backgroundImage ? `url(${environment.backgroundImage})` : undefined,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                backgroundRepeat: 'no-repeat',
            }}
        >
            <div className={styles.headerContainer}>
                <p className={styles.statusBar}>
                    ステータス: {isConnected ? '接続済み' : '切断'}
                    {error && <span className={styles.errorText}>{error}</span>}
                </p>
                <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                    {currentUser && <p className={styles.userInfo}>ログイン中: {currentUser.name}</p>}
                </div>
            </div>

            <div ref={canvasRef} className={styles.worldCanvas}>
                <div className={styles.userListContainer}>
                    <h2 className={styles.userListTitle}>参加ユーザー ({users.size}人)</h2>
                    <ul className={styles.userList}>
                        {Array.from(users.values()).map((user) => (
                            <li key={user.id}>
                                {user.name} ({user.status}){user.id === currentUser?.id && ' (あなた)'}
                            </li>
                        ))}
                    </ul>
                </div>

                {/* Entities and Plugins are handled by UbichillOverlay */}
                <UbichillOverlay />

                {/* App-Level Plugins */}
                {APP_PLUGINS.map((plugin) => {
                    const canvasOffset = canvasRef.current?.getBoundingClientRect() || { left: 0, top: 0 };

                    // Type-safe plugin rendering based on plugin type
                    switch (plugin.id) {
                        case 'avatar':
                            return (
                                <plugin.Component
                                    key={plugin.id}
                                    cursorState={cursorState}
                                    userStatus={userStatus}
                                    onStatusChange={handleStatusChange}
                                    mousePosition={mousePosition}
                                    canvasOffset={canvasOffset}
                                />
                            );
                        case 'pen-tray':
                            return <PenTray key={plugin.id} />;
                        default:
                            return null;
                    }
                })}
            </div>
        </main>
    );
}
