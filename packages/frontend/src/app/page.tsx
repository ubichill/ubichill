'use client';

import { useState } from 'react';
import { useSocket } from '@/hooks/useSocket';
import * as styles from './styles';

export default function Home() {
    const { isConnected, users, currentUser, error, joinRoom, updatePosition } = useSocket();
    const [name, setName] = useState('');
    const [hasJoined, setHasJoined] = useState(false);

    const handleJoin = (e: React.FormEvent) => {
        e.preventDefault();
        if (name.trim()) {
            joinRoom(name);
            setHasJoined(true);
        }
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        if (hasJoined) {
            updatePosition({ x: e.clientX, y: e.clientY });
        }
    };

    return (
        <main
            className={styles.mainContainer}
            onMouseMove={handleMouseMove}
        >
            <div className={styles.headerContainer}>
                <p className={styles.statusBar}>
                    Status: {isConnected ? 'Connected' : 'Disconnected'}
                    {error && <span className={styles.errorText}>{error}</span>}
                </p>
                {currentUser && (
                    <p className={styles.userInfo}>
                        Logged in as: {currentUser.name}
                    </p>
                )}
            </div>

            {!hasJoined ? (
                <div className={styles.loginContainer}>
                    <h1 className={styles.title}>Ubichill</h1>
                    <form onSubmit={handleJoin} className={styles.loginForm}>
                        <input
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="Enter your name"
                            className={styles.input}
                        />
                        <button
                            type="submit"
                            className={styles.button}
                            disabled={!isConnected}
                        >
                            Join
                        </button>
                    </form>
                </div>
            ) : (
                <div className={styles.roomCanvas}>
                    <div className={styles.userListContainer}>
                        <h2 className={styles.userListTitle}>Room Users ({users.length})</h2>
                        <ul className={styles.userList}>
                            {users.map(user => (
                                <li key={user.id}>
                                    {user.name} ({user.status})
                                    {user.id === currentUser?.id && ' (You)'}
                                </li>
                            ))}
                        </ul>
                    </div>

                    {/* Cursors */}
                    {users.map(user => (
                        user.id !== currentUser?.id && (
                            <div
                                key={user.id}
                                className={styles.cursor}
                                style={{
                                    left: user.position.x,
                                    top: user.position.y,
                                    transform: 'translate(-50%, -50%)'
                                }}
                            >
                                <span className={styles.cursorLabel}>
                                    {user.name}
                                </span>
                            </div>
                        )
                    ))}
                </div>
            )}
        </main>
    );
}
