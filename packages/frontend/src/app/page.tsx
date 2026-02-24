'use client';

import { PenTray } from '@ubichill/plugin-pen';
import { useSocket, useWorld } from '@ubichill/sdk';
import type { CursorState, UserStatus } from '@ubichill/shared';
import { useCallback, useRef, useState } from 'react';
import { Lobby } from '@/components/lobby';
import { UbichillOverlay } from '@/components/UbichillOverlay';
import { useCursorState } from '@/core/hooks/useCursorState';
import { APP_PLUGINS } from '@/plugins/registry';
import { css } from '@/styled-system/css';
import * as styles from '@/styles/styles';

type AppScreen = 'name' | 'lobby' | 'world';

export default function Home() {
    const { isConnected, users, currentUser, error, joinWorld, updatePosition } = useSocket();
    const { environment } = useWorld();
    const [name, setName] = useState('');
    const [screen, setScreen] = useState<AppScreen>('name');

    // 現在のカーソル状態を取得
    const cursorState: CursorState = useCursorState();

    // User status (busy = 作業中でカーソル固定)
    const [userStatus, setUserStatus] = useState<UserStatus>('online');
    const [cursorLockPosition, setCursorLockPosition] = useState<{ x: number; y: number } | null>(null);
    const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });

    // 名前入力完了
    const handleNameSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (name.trim()) {
            setScreen('lobby');
        }
    };

    // インスタンスに参加
    const handleJoinInstance = (instanceId: string, worldId: string) => {
        joinWorld(name, worldId, instanceId);
        setScreen('world');
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

    // 名前入力画面
    if (screen === 'name') {
        return (
            <main className={styles.mainContainer}>
                <div className={styles.texturedBackdrop} />
                <div className={styles.shell}>
                    <div className={styles.headerContainer}>
                        <p className={styles.statusBar}>
                            ステータス: {isConnected ? '接続済み' : '切断'}
                            {error && <span className={styles.errorText}>{error}</span>}
                        </p>
                    </div>

                    <div className={styles.loginContainer}>
                        <p className={styles.titleTag}>TITLE</p>
                        <div className={styles.brandTitleRow}>
                            <svg
                                className={styles.brandIcon}
                                viewBox="0 0 64 64"
                                role="img"
                                aria-label="ubichill icon"
                                xmlns="http://www.w3.org/2000/svg"
                            >
                                <rect x="4" y="4" width="56" height="56" rx="18" fill="#1e3155" />
                                <path
                                    d="M21 40v-8.2c0-1.9 1.6-3.5 3.5-3.5s3.5 1.6 3.5 3.5V39h1.2v-4.8c0-1.7 1.3-3 3-3s3 1.3 3 3V40c0 5.5-4.4 10-9.9 10h-.8C19 50 15 46 15 41.1V36c0-1.7 1.4-3.1 3.1-3.1s3.1 1.4 3.1 3.1V40H21z"
                                    fill="#f6e8d2"
                                />
                                <path
                                    d="M30 18.5c1.7-1.2 3.4-1.2 5.1 0s3.4 1.2 5.1 0"
                                    fill="none"
                                    stroke="#f6e8d2"
                                    strokeWidth="2.5"
                                    strokeLinecap="round"
                                />
                                <path
                                    d="M33 23c1.3-.9 2.6-.9 3.9 0s2.6.9 3.9 0"
                                    fill="none"
                                    stroke="#f6e8d2"
                                    strokeWidth="2.5"
                                    strokeLinecap="round"
                                />
                                <circle cx="24.5" cy="24.5" r="2.5" fill="#f6e8d2" />
                            </svg>
                            <h1 className={styles.title}>ubichill</h1>
                        </div>
                        <p className={styles.subtitle}>作業を始める前に表示名を入力してください</p>
                        <form onSubmit={handleNameSubmit} className={styles.loginForm}>
                            <input
                                type="text"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder="表示名を入力"
                                className={styles.input}
                            />
                            <button type="submit" className={styles.button} disabled={!isConnected || !name.trim()}>
                                開始
                            </button>
                        </form>
                        <p className={styles.hintText}>※ 表示名は後で設定画面から変更できます</p>
                    </div>
                </div>
            </main>
        );
    }

    // ロビー画面
    if (screen === 'lobby') {
        return (
            <main className={styles.mainContainer}>
                <div className={styles.texturedBackdrop} />
                <div className={styles.shell}>
                    <div className={styles.headerContainer}>
                        <p className={styles.statusBar}>
                            ステータス: {isConnected ? '接続済み' : '切断'}
                            {error && <span className={styles.errorText}>{error}</span>}
                        </p>
                        <button type="button" onClick={() => setScreen('name')} className={styles.backButton}>
                            ← 戻る
                        </button>
                    </div>

                    <Lobby onJoinInstance={handleJoinInstance} />
                </div>
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
            <div className={styles.shell}>
                <div className={styles.headerContainer}>
                    <p className={styles.statusBar}>
                        ステータス: {isConnected ? '接続済み' : '切断'}
                        {error && <span className={styles.errorText}>{error}</span>}
                    </p>
                    <div
                        className={css({
                            display: 'flex',
                            gap: '4',
                            alignItems: 'center',
                        })}
                    >
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
            </div>
        </main>
    );
}
