'use client';

import { useEntity, useSocket } from '@ubichill/sdk';
import type { AppAvatarDef, CursorState, UserStatus } from '@ubichill/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CursorMenu } from './components/CursorMenu';
import { EmojiFloat, type FloatingEmoji } from './components/EmojiFloat';
import { RadialMenu, type RadialMenuItem } from './components/RadialMenu';

export interface AvatarPluginProps {
    cursorState: CursorState;
    userStatus: UserStatus;
    onStatusChange: (status: UserStatus) => void;
    mousePosition: { x: number; y: number };
}

/**
 * Avatar Plugin - Manages avatar cursors, radial menu, emoji reactions, and status
 */
export const AvatarPlugin: React.FC<AvatarPluginProps> = ({
    cursorState,
    userStatus: _userStatus,
    onStatusChange,
    mousePosition,
}) => {
    // SDK hooks
    const { currentUser, users, updateUser, socket: _socket, isConnected } = useSocket();
    const usersArray = Array.from(users.values());

    // 絵文字ブロードキャスト用のエンティティ (ephemeralデータとして共有)
    const { ephemeral: emojiEphemeral, syncStream: broadcastEmoji } = useEntity<{
        emoji: string;
        position: { x: number; y: number };
        userId: string;
        timestamp: number;
    }>('emoji-broadcast');
    // ローカルカーソル設定 (AppAvatarDef)
    const [localAvatar, _setLocalAvatar] = useState<AppAvatarDef>(() => currentUser?.avatar ?? { states: {} });
    const [hasUserModifiedAvatar, setHasUserModifiedAvatar] = useState(false);
    const setLocalAvatar = (value: AppAvatarDef | ((prev: AppAvatarDef) => AppAvatarDef)) => {
        setHasUserModifiedAvatar(true);
        _setLocalAvatar(value as AppAvatarDef);
    };

    const [smoothAvatarPosition, setSmoothAvatarPosition] = useState({ x: 0, y: 0 });
    const animationFrameRef = useRef<number | null>(null);

    // RadialMenu state
    const [showRadialMenu, setShowRadialMenu] = useState(false);
    const [radialMenuPosition, setRadialMenuPosition] = useState({ x: 0, y: 0 });

    // Floating emojis state
    const [floatingEmojis, setFloatingEmojis] = useState<FloatingEmoji[]>([]);

    // カーソル画像のサーバー同期
    useEffect(() => {
        if (currentUser?.avatar && !hasUserModifiedAvatar) {
            _setLocalAvatar(currentUser.avatar);
        }
    }, [currentUser?.avatar, hasUserModifiedAvatar]);

    useEffect(() => {
        if (!currentUser?.id || !isConnected) {
            return;
        }
        if (!hasUserModifiedAvatar) {
            return;
        }
        if (JSON.stringify(currentUser.avatar) !== JSON.stringify(localAvatar)) {
            updateUser({ avatar: localAvatar });
        }
    }, [localAvatar, isConnected, currentUser?.id, updateUser, currentUser?.avatar, hasUserModifiedAvatar]);

    // 絵文字ブロードキャストを受信
    useEffect(() => {
        if (!emojiEphemeral || typeof emojiEphemeral !== 'object') return;

        const data = emojiEphemeral as {
            emoji: string;
            position: { x: number; y: number };
            userId: string;
            timestamp: number;
        };

        // 自分が送信した絵文字は除外
        if (data.userId === currentUser?.id) return;

        const newEmoji: FloatingEmoji = {
            id: `${data.timestamp}-${data.userId}`,
            emoji: data.emoji,
            position: data.position,
            timestamp: data.timestamp,
        };

        setFloatingEmojis((prev) => [...prev, newEmoji]);
    }, [emojiEphemeral, currentUser?.id]);

    // 右クリックでRadialMenuを開く
    useEffect(() => {
        const handleContextMenu = (e: MouseEvent) => {
            e.preventDefault();
            setRadialMenuPosition({ x: e.clientX, y: e.clientY });
            setShowRadialMenu(true);
        };

        window.addEventListener('contextmenu', handleContextMenu);
        return () => window.removeEventListener('contextmenu', handleContextMenu);
    }, []);

    // ステータス変更
    const changeStatus = useCallback(
        (newStatus: UserStatus) => {
            onStatusChange(newStatus);
            updateUser({ status: newStatus });
            setShowRadialMenu(false);
        },
        [updateUser, onStatusChange],
    );

    // 絵文字送信
    const sendEmoji = useCallback(
        (emoji: string) => {
            if (!currentUser?.id) return;

            const newEmoji: FloatingEmoji = {
                id: Date.now().toString(),
                emoji,
                position: { x: mousePosition.x, y: mousePosition.y },
                timestamp: Date.now(),
            };
            setFloatingEmojis((prev) => [...prev, newEmoji]);

            // SDKのephemeralデータとして他のユーザーに送信
            broadcastEmoji({
                emoji,
                position: mousePosition,
                userId: currentUser.id,
                timestamp: Date.now(),
            });

            setShowRadialMenu(false);
        },
        [mousePosition, currentUser?.id, broadcastEmoji],
    );

    // 絵文字アニメーション完了
    const handleEmojiComplete = useCallback((id: string) => {
        setFloatingEmojis((prev) => prev.filter((e) => e.id !== id));
    }, []);

    // RadialMenu items
    const radialMenuItems: RadialMenuItem[] = [
        {
            id: 'emoji',
            label: '絵文字',
            icon: '😊',
            submenu: [
                {
                    id: 'emoji-thumbsup',
                    label: 'いいね',
                    icon: '👍',
                    action: () => sendEmoji('👍'),
                },
                {
                    id: 'emoji-heart',
                    label: 'ハート',
                    icon: '❤️',
                    action: () => sendEmoji('❤️'),
                },
                {
                    id: 'emoji-laugh',
                    label: '笑い',
                    icon: '😂',
                    action: () => sendEmoji('😂'),
                },
                {
                    id: 'emoji-clap',
                    label: '拍手',
                    icon: '👏',
                    action: () => sendEmoji('👏'),
                },
                {
                    id: 'emoji-fire',
                    label: '炎',
                    icon: '🔥',
                    action: () => sendEmoji('🔥'),
                },
                {
                    id: 'emoji-thinking',
                    label: '考え中',
                    icon: '🤔',
                    action: () => sendEmoji('🤔'),
                },
            ],
        },
        {
            id: 'status',
            label: 'ステータス',
            icon: '🟢',
            submenu: [
                {
                    id: 'status-online',
                    label: 'オンライン',
                    icon: '🟢',
                    action: () => changeStatus('online'),
                },
                {
                    id: 'status-busy',
                    label: '作業中',
                    icon: '🔴',
                    action: () => changeStatus('busy'),
                },
                {
                    id: 'status-dnd',
                    label: '起こさないで',
                    icon: '🔕',
                    action: () => changeStatus('dnd'),
                },
            ],
        },
    ];

    // 現在の状態に対応するローカルアバターカーソルURLを取得
    const currentLocalAvatar = localAvatar.states[cursorState] || localAvatar.states.default;
    const localAvatarUrl = currentLocalAvatar?.url;
    const localHotspot = currentLocalAvatar?.hotspot || { x: 0, y: 0 };

    // 滑らかなアバター追跡のためのアニメーションループ
    useEffect(() => {
        const lerp = (start: number, end: number, factor: number) => {
            return start + (end - start) * factor;
        };

        const animate = () => {
            setSmoothAvatarPosition((prev) => {
                const lerpFactor = 0.2;
                return {
                    x: lerp(prev.x, mousePosition.x, lerpFactor),
                    y: lerp(prev.y, mousePosition.y, lerpFactor),
                };
            });
            animationFrameRef.current = requestAnimationFrame(animate);
        };

        animationFrameRef.current = requestAnimationFrame(animate);

        return () => {
            if (animationFrameRef.current !== null) {
                cancelAnimationFrame(animationFrameRef.current);
            }
        };
    }, [mousePosition]);

    // アバターカーソルスタイル制御 (ローカル)
    useEffect(() => {
        if (!localAvatarUrl) {
            return;
        }

        document.body.classList.add('cursor-hidden');

        let style = document.getElementById('cursor-none-style') as HTMLStyleElement | null;
        if (!style) {
            style = document.createElement('style');
            style.id = 'cursor-none-style';
            style.innerHTML = `
                body.cursor-hidden * {
                    cursor: none !important;
                }
            `;
            document.head.appendChild(style);
        }

        return () => {
            document.body.classList.remove('cursor-hidden');
            const existingStyle = document.getElementById('cursor-none-style');
            if (existingStyle) {
                existingStyle.remove();
            }
        };
    }, [localAvatarUrl]);

    return (
        <>
            {/* Cursor Menu (Avatar Settings) - Right Side Panel */}
            <div
                style={{
                    position: 'fixed',
                    top: '16px',
                    right: '16px',
                    zIndex: 9998,
                    maxWidth: '400px',
                    maxHeight: 'calc(100vh - 32px)',
                    overflowY: 'auto',
                }}
            >
                <CursorMenu avatar={localAvatar} onAvatarChange={setLocalAvatar} />
            </div>

            {/* Remote Users' Avatars */}
            {usersArray
                .filter((user) => user.id !== currentUser?.id)
                .map((user) => {
                    const userAvatarState = user.avatar?.states?.[cursorState] || user.avatar?.states?.default;
                    const remoteUrl = userAvatarState?.url;
                    const remoteHotspot = userAvatarState?.hotspot || { x: 0, y: 0 };

                    return (
                        <div
                            key={user.id}
                            style={{
                                position: 'fixed',
                                pointerEvents: 'none',
                                zIndex: 100,
                                backgroundColor: remoteUrl ? 'transparent' : '#4263eb',
                                color: 'white',
                                padding: remoteUrl ? undefined : '4px 8px',
                                borderRadius: remoteUrl ? '0' : '12px',
                                fontSize: '12px',
                                whiteSpace: 'nowrap',
                                left: user.position.x,
                                top: user.position.y,
                                transform: 'none',
                                width: remoteUrl ? 'auto' : undefined,
                                height: remoteUrl ? 'auto' : undefined,
                            }}
                        >
                            {remoteUrl ? (
                                <div
                                    style={{
                                        position: 'relative',
                                        transform: `translate(${-remoteHotspot.x}px, ${-remoteHotspot.y}px)`,
                                    }}
                                >
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
                                    <span
                                        style={{
                                            display: 'block',
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
                                <span
                                    style={{
                                        display: 'block',
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

            {/* Local Avatar Cursor */}
            {localAvatarUrl && (
                <img
                    src={localAvatarUrl}
                    alt="avatar cursor"
                    style={{
                        position: 'fixed',
                        left: smoothAvatarPosition.x - localHotspot.x,
                        top: smoothAvatarPosition.y - localHotspot.y,
                        pointerEvents: 'none',
                        zIndex: 9999,
                        maxWidth: '64px',
                        maxHeight: '64px',
                        width: 'auto',
                        height: 'auto',
                        transition: 'none',
                    }}
                />
            )}

            {/* Radial Menu */}
            {showRadialMenu && (
                <RadialMenu
                    position={radialMenuPosition}
                    items={radialMenuItems}
                    onClose={() => setShowRadialMenu(false)}
                />
            )}

            {/* Floating Emojis */}
            <EmojiFloat emojis={floatingEmojis} onComplete={handleEmojiComplete} />
        </>
    );
};
