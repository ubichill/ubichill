'use client';

import type { AppAvatarDef } from '@ubichill/shared';
import { useEffect, useRef, useState } from 'react';
import { CursorMenu } from '@/components/CursorMenu';
import { Lobby } from '@/components/lobby';
import { useWorld } from '@/core/contexts/WorldContext';
import { useCursorState } from '@/core/hooks/useCursorState';
import { useSocket } from '@/core/hooks/useSocket';
import * as styles from '@/styles/styles';

type AppScreen = 'name' | 'lobby' | 'room';

export default function Home() {
    const { isConnected, users, currentUser, error, joinRoom, updatePosition, updateUser } = useSocket();
    const { environment } = useWorld();
    const [name, setName] = useState('');
    const [screen, setScreen] = useState<AppScreen>('name');

    // 現在のカーソル状態を取得
    const cursorState = useCursorState();

    // ローカルカーソル設定 (AppAvatarDef)
    // 初期値はcurrentUserから復元できると良いが、今は簡易的にnullスタート
    const [localAvatar, setLocalAvatar] = useState<AppAvatarDef>({ states: {} });

    const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });

    // カーソル画像のサーバー同期
    useEffect(() => {
        if (currentUser?.id && isConnected) {
            // ローカルのavatar設定が変更されたらサーバーに同期
            // 比較が難しいので、変更があった体で送る（頻度調整が必要かも）
            // deep equal checkなどを入れるのが理想だが、一旦簡易実装
            if (JSON.stringify(currentUser.avatar) !== JSON.stringify(localAvatar)) {
                updateUser({ avatar: localAvatar });
            }
        }
    }, [localAvatar, isConnected, currentUser?.id, updateUser, currentUser?.avatar]);

    // 名前入力完了
    const handleNameSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (name.trim()) {
            setScreen('lobby');
        }
    };

    // インスタンスに参加
    const handleJoinInstance = (instanceId: string, roomId: string) => {
        joinRoom(name, roomId, instanceId);
        setScreen('room');
    };

    // Add ref for the container
    const canvasRef = useRef<HTMLDivElement>(null);

    const handleMouseMove = (e: React.MouseEvent) => {
        // ローカルカーソル用（画面全体での追跡）
        setMousePosition({ x: e.clientX, y: e.clientY });

        if (screen === 'room' && canvasRef.current) {
            const rect = canvasRef.current.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;

            // 状態も一緒に送信
            updatePosition({ x, y }, cursorState);
        }
    };

    // 現在の状態に対応するローカルカーソルURLを取得
    const currentLocalCursor = localAvatar.states[cursorState] || localAvatar.states.default;
    const localCursorUrl = currentLocalCursor?.url;
    const localHotspot = currentLocalCursor?.hotspot || { x: 0, y: 0 };

    // カーソルスタイル制御 (ローカル)
    useEffect(() => {
        if (localCursorUrl) {
            // 全要素でカーソルを非表示にするスタイルを追加
            const style = document.createElement('style');
            style.innerHTML = `
                * {
                    cursor: none !important;
                }
            `;
            style.id = 'cursor-none-style';
            document.head.appendChild(style);

            return () => {
                const existingStyle = document.getElementById('cursor-none-style');
                if (existingStyle) {
                    existingStyle.remove();
                }
            };
        }
    }, [localCursorUrl]);

    // 名前入力画面
    if (screen === 'name') {
        return (
            <main className={styles.mainContainer}>
                <div className={styles.headerContainer}>
                    <p className={styles.statusBar}>
                        Status: {isConnected ? 'Connected' : 'Disconnected'}
                        {error && <span className={styles.errorText}>{error}</span>}
                    </p>
                </div>

                <div className={styles.loginContainer}>
                    <h1 className={styles.title}>Ubichill</h1>
                    <p style={{ color: '#868e96', marginBottom: '24px', fontSize: '14px' }}>
                        2Dメタバーススタイルのコラボレーションスペース
                    </p>
                    <form onSubmit={handleNameSubmit} className={styles.loginForm}>
                        <input
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="名前を入力してください"
                            className={styles.input}
                        />
                        <button type="submit" className={styles.button} disabled={!isConnected || !name.trim()}>
                            続ける
                        </button>
                    </form>
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
                        Status: {isConnected ? 'Connected' : 'Disconnected'}
                        {error && <span className={styles.errorText}>{error}</span>}
                    </p>
                    <button
                        type="button"
                        onClick={() => setScreen('name')}
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
                        ← 戻る
                    </button>
                </div>

                <Lobby userName={name} onJoinInstance={handleJoinInstance} />
            </main>
        );
    }

    // ルーム画面
    return (
        <main
            className={styles.mainContainer}
            onMouseMove={handleMouseMove}
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
                    Status: {isConnected ? 'Connected' : 'Disconnected'}
                    {error && <span className={styles.errorText}>{error}</span>}
                </p>
                <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                    <CursorMenu avatar={localAvatar} onAvatarChange={setLocalAvatar} />
                    {currentUser && <p className={styles.userInfo}>Logged in as: {currentUser.name}</p>}
                </div>
            </div>

            <div ref={canvasRef} className={styles.roomCanvas}>
                <div className={styles.userListContainer}>
                    <h2 className={styles.userListTitle}>Room Users ({users.size})</h2>
                    <ul className={styles.userList}>
                        {Array.from(users.values()).map((user) => (
                            <li key={user.id}>
                                {user.name} ({user.status}){user.id === currentUser?.id && ' (You)'}
                            </li>
                        ))}
                    </ul>
                </div>

                {/* Cursors */}
                {Array.from(users.values()).map((user) => {
                    if (user.id === currentUser?.id) return null;

                    // リモートユーザーのカーソル解決
                    const remoteState = user.cursorState || 'default';
                    // avatar定義か、古いcursorUrlへフォールバック
                    const remoteAvatarState = user.avatar?.states?.[remoteState] || user.avatar?.states?.default;
                    const remoteUrl = remoteAvatarState?.url || user.cursorUrl;
                    const remoteHotspot = remoteAvatarState?.hotspot || { x: 0, y: 0 };
                    return (
                        <div
                            key={user.id}
                            className={styles.cursor}
                            style={{
                                left: user.position.x,
                                top: user.position.y,
                                // Remove translate(-50%, -50%) from default style if present, or override it.
                                // styles.cursor might have default transforms, so we might need to be careful.
                                // Actually styles.cursor does NOT have transform.
                                // But previous code added transform: 'translate(-50%, -50%)'.
                                // We will use top-left positioning and shift by hotspot.
                                transform: 'none',

                                // 画像がある場合はデフォルトのスタイルを無効化
                                backgroundColor: remoteUrl ? 'transparent' : undefined,
                                width: remoteUrl ? 'auto' : undefined,
                                height: remoteUrl ? 'auto' : undefined,
                                borderRadius: remoteUrl ? '0' : undefined,
                                pointerEvents: 'none',
                                zIndex: 100,
                            }}
                        >
                            {remoteUrl ? (
                                <div
                                    style={{
                                        position: 'relative',
                                        // ホットスポット分だけずらす
                                        transform: `translate(${-remoteHotspot.x}px, ${-remoteHotspot.y}px)`,
                                    }}
                                >
                                    {/* Custom Cursor Image for Remote User */}
                                    <img
                                        src={remoteUrl}
                                        alt={`${user.name}'s cursor`}
                                        style={{
                                            maxWidth: '64px',
                                            maxHeight: '64px',
                                            pointerEvents: 'none',
                                            display: 'block',
                                        }}
                                    />
                                    {/* Name Label below image */}
                                    <span
                                        className={styles.cursorLabel}
                                        style={{
                                            position: 'absolute',
                                            top: '100%',
                                            left: '50%',
                                            transform: 'translateX(-50%)',
                                            marginTop: '4px',
                                            whiteSpace: 'nowrap',
                                        }}
                                    >
                                        {user.name}
                                    </span>
                                </div>
                            ) : (
                                /* Default Cursor Label (or shape) */
                                <span
                                    className={styles.cursorLabel}
                                    style={{
                                        top: '100%',
                                        marginTop: '4px',
                                        transform: 'translateX(-50%)',
                                    }}
                                >
                                    {user.name}
                                </span>
                            )}
                        </div>
                    );
                })}
                {/* Custom Local Cursor */}
                {localCursorUrl && (
                    <img
                        src={localCursorUrl}
                        alt="cursor"
                        style={{
                            position: 'fixed',
                            left: mousePosition.x - localHotspot.x,
                            top: mousePosition.y - localHotspot.y,
                            pointerEvents: 'none',
                            zIndex: 9999,
                        }}
                    />
                )}
            </div>
        </main>
    );
}
