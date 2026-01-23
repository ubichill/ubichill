'use client';

import { useState } from 'react';
import { useSocket } from '@/hooks/useSocket';
import { css } from '../../styled-system/css';
import { center, flex, vstack, hstack } from '../../styled-system/patterns';

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
            className={flex({
                minH: 'screen',
                direction: 'column',
                align: 'center',
                justify: 'space-between',
                p: '24'
            })}
            onMouseMove={handleMouseMove}
        >
            <div className={css({
                zIndex: 10,
                w: 'full',
                maxW: '5xl',
                alignItems: 'center',
                justifyContent: 'space-between',
                fontFamily: 'mono',
                fontSize: 'sm',
                lg: { display: 'flex' }
            })}>
                <p className={css({
                    pos: 'fixed',
                    left: 0,
                    top: 0,
                    display: 'flex',
                    w: 'full',
                    justifyContent: 'center',
                    borderBottomWidth: '1px',
                    borderColor: 'border',
                    bg: { base: 'zinc.200', _dark: 'zinc.800/30' },
                    pb: '6',
                    pt: '8',
                    backdropFilter: 'blur(16px)',
                    lg: {
                        pos: 'static',
                        w: 'auto',
                        rounded: 'xl',
                        borderWidth: '1px',
                        bg: 'gray.200',
                        p: '4'
                    }
                })}>
                    Status: {isConnected ? 'Connected' : 'Disconnected'}
                    {error && <span className={css({ color: 'red.500', ml: '4' })}>{error}</span>}
                </p>
                {currentUser && (
                    <p className={css({ pos: 'fixed', right: 0, top: 0, p: '4' })}>
                        Logged in as: {currentUser.name}
                    </p>
                )}
            </div>

            {!hasJoined ? (
                <div className={vstack({ gap: '4', align: 'center' })}>
                    <h1 className={css({ fontSize: '4xl', fontWeight: 'bold' })}>Ubichill</h1>
                    <form onSubmit={handleJoin} className={hstack({ gap: '2' })}>
                        <input
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="Enter your name"
                            className={css({
                                p: '2',
                                borderWidth: '1px',
                                borderColor: 'border',
                                rounded: 'md',
                                color: 'text'
                            })}
                        />
                        <button
                            type="submit"
                            className={css({
                                p: '2',
                                bg: 'blue.500',
                                color: 'white',
                                rounded: 'md',
                                _hover: { bg: 'blue.600' },
                                _disabled: { opacity: 0.5, cursor: 'not-allowed' }
                            })}
                            disabled={!isConnected}
                        >
                            Join
                        </button>
                    </form>
                </div>
            ) : (
                <div className={css({
                    pos: 'relative',
                    w: 'full',
                    h: '600px',
                    borderWidth: '1px',
                    borderColor: 'white/5',
                    rounded: 'lg',
                    overflow: 'hidden',
                    bg: 'white/5'
                })}>
                    <div className={css({ pos: 'absolute', top: '4', left: '4' })}>
                        <h2 className={css({ fontSize: 'xl' })}>Room Users ({users.length})</h2>
                        <ul className={css({ listStyleType: 'disc', pl: '5' })}>
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
                                className={css({
                                    pos: 'absolute',
                                    w: '4',
                                    h: '4',
                                    bg: 'red.500/50',
                                    rounded: 'full',
                                    pointerEvents: 'none',
                                    transitionProperty: 'all',
                                    transitionDuration: '100ms',
                                    transitionTimingFunction: 'linear'
                                })}
                                style={{
                                    left: user.position.x,
                                    top: user.position.y,
                                    transform: 'translate(-50%, -50%)'
                                }}
                            >
                                <span className={css({
                                    pos: 'absolute',
                                    top: '-6',
                                    left: '50%',
                                    transform: 'translateX(-50%)',
                                    fontSize: 'xs',
                                    bg: 'black/70',
                                    color: 'white',
                                    px: '1',
                                    rounded: 'sm',
                                    whiteSpace: 'nowrap'
                                })}>
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
