'use client';

import { useRef, useState } from 'react';
import { Lobby } from '@/components/lobby';
import { useSocket } from '@/core/hooks/useSocket';
import * as styles from '@/styles/styles';

type AppScreen = 'name' | 'lobby' | 'room';

export default function Home() {
    const { isConnected, users, currentUser, error, joinRoom, updatePosition } = useSocket();
    const [name, setName] = useState('');
    const [screen, setScreen] = useState<AppScreen>('name');

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
        if (screen === 'room' && canvasRef.current) {
            const rect = canvasRef.current.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            updatePosition({ x, y });
        }
    };

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
        <main className={styles.mainContainer} onMouseMove={handleMouseMove}>
            <div className={styles.headerContainer}>
                <p className={styles.statusBar}>
                    Status: {isConnected ? 'Connected' : 'Disconnected'}
                    {error && <span className={styles.errorText}>{error}</span>}
                </p>
                {currentUser && <p className={styles.userInfo}>Logged in as: {currentUser.name}</p>}
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
                {Array.from(users.values()).map(
                    (user) =>
                        user.id !== currentUser?.id && (
                            <div
                                key={user.id}
                                className={styles.cursor}
                                style={{
                                    left: user.position.x,
                                    top: user.position.y,
                                    transform: 'translate(-50%, -50%)',
                                }}
                            >
                                <span className={styles.cursorLabel}>{user.name}</span>
                            </div>
                        ),
                )}
            </div>
        </main>
    );
}
