'use client';

import { useEntity, useSocket } from '@ubichill/sdk';
import type { AppAvatarDef, CursorState, UserStatus } from '@ubichill/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AvatarCursor } from './AvatarCursor';
import { CursorMenu } from './components/CursorMenu';
import { EmojiFloat, type FloatingEmoji } from './components/EmojiFloat';
import { RadialMenu, type RadialMenuItem } from './components/RadialMenu';

export interface AvatarPluginProps {
    cursorState: CursorState;
    userStatus: UserStatus;
    onStatusChange: (status: UserStatus) => void;
    mousePosition: { x: number; y: number };
    canvasOffset?: { left: number; top: number };
    showRadialMenu?: boolean;
    onRadialMenuOpen?: (position: { x: number; y: number }) => void;
}

/**
 * Avatar Plugin - Manages avatar cursors, radial menu, emoji reactions, and status
 */
export const AvatarPlugin: React.FC<AvatarPluginProps> = ({
    cursorState,
    userStatus: _userStatus,
    onStatusChange,
    mousePosition,
    canvasOffset = { left: 0, top: 0 },
}) => {
    // SDK hooks
    const { currentUser, users, updateUser, socket: _socket, isConnected } = useSocket();

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

    // RadialMenu state - positionがnullでない時にメニュー表示
    const [radialMenuPosition, setRadialMenuPosition] = useState<{ x: number; y: number } | null>(null);
    const menuOpenPositionRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
    const showRadialMenu = radialMenuPosition !== null;

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

    // メニュー位置のrefを更新
    useEffect(() => {
        if (!showRadialMenu) {
            menuOpenPositionRef.current = mousePosition;
        }
    }, [mousePosition, showRadialMenu]);

    // 右クリックでRadialMenuを開く
    useEffect(() => {
        const handleContextMenu = (e: MouseEvent) => {
            e.preventDefault();
            const position = { x: e.clientX, y: e.clientY };
            // 位置を設定することでメニューを表示
            setRadialMenuPosition(position);
            menuOpenPositionRef.current = position;
            // メニュー開始を同期
            updateUser({ isMenuOpen: true });
        };

        window.addEventListener('contextmenu', handleContextMenu);
        return () => window.removeEventListener('contextmenu', handleContextMenu);
    }, [updateUser]);

    // ステータス変更
    const changeStatus = useCallback(
        (newStatus: UserStatus) => {
            onStatusChange(newStatus);
            updateUser({ status: newStatus, isMenuOpen: false });
            setRadialMenuPosition(null);
        },
        [updateUser, onStatusChange],
    );

    // 絵文字送信
    const sendEmoji = useCallback(
        (emoji: string) => {
            if (!currentUser?.id) return;

            // メニューが開いている場合はメニューを開いた時の位置を使用、そうでなければ現在のマウス位置
            const emojiPosition = showRadialMenu ? menuOpenPositionRef.current : mousePosition;

            const newEmoji: FloatingEmoji = {
                id: Date.now().toString(),
                emoji,
                position: emojiPosition,
                timestamp: Date.now(),
            };
            setFloatingEmojis((prev) => [...prev, newEmoji]);

            // SDKのephemeralデータとして他のユーザーに送信
            broadcastEmoji({
                emoji,
                position: emojiPosition,
                userId: currentUser.id,
                timestamp: Date.now(),
            });

            setRadialMenuPosition(null);
            // メニュー閉じたことを同期
            updateUser({ isMenuOpen: false });
        },
        [currentUser?.id, broadcastEmoji, showRadialMenu, mousePosition, updateUser],
    );

    // 絵文字アニメーション完了
    const handleEmojiComplete = useCallback((id: string) => {
        setFloatingEmojis((prev) => prev.filter((e) => e.id !== id));
    }, []);

    // RadialMenu items
    const radialMenuItems: RadialMenuItem[] = useMemo(
        () => [
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
        ],
        [sendEmoji, changeStatus],
    );

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
            {useMemo(
                () =>
                    Array.from(users.values())
                        .filter((user) => user.id !== currentUser?.id)
                        .map((user) => {
                            // Use remote user's cursor state, fallback to default
                            const remoteCursorState = user.cursorState || 'default';
                            const userAvatarState =
                                user.avatar?.states?.[remoteCursorState] || user.avatar?.states?.default;
                            const remoteUrl = userAvatarState?.url;
                            const remoteHotspot = userAvatarState?.hotspot || { x: 0, y: 0 };
                            // メニュー開いているユーザーは位置を固定表示
                            const displayPosition = user.position;

                            return (
                                <div
                                    key={user.id}
                                    style={{
                                        position: 'fixed',
                                        pointerEvents: 'none',
                                        zIndex: 10000,
                                        left: canvasOffset.left + displayPosition.x - remoteHotspot.x,
                                        top: canvasOffset.top + displayPosition.y - remoteHotspot.y,
                                    }}
                                >
                                    {remoteUrl ? (
                                        <>
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
                                            {user.status === 'busy' && (
                                                <div
                                                    style={{
                                                        position: 'absolute',
                                                        top: '-8px',
                                                        right: '-8px',
                                                        width: '20px',
                                                        height: '20px',
                                                        borderRadius: '50%',
                                                        backgroundColor: '#fa5252',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'center',
                                                        fontSize: '12px',
                                                        boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
                                                    }}
                                                >
                                                    🔴
                                                </div>
                                            )}
                                            <span
                                                style={{
                                                    display: 'block',
                                                    position: 'absolute',
                                                    top: '100%',
                                                    left: '50%',
                                                    transform: 'translateX(-50%)',
                                                    marginTop: '4px',
                                                    whiteSpace: 'nowrap',
                                                    fontSize: '12px',
                                                    background: 'rgba(0,0,0,0.7)',
                                                    color: 'white',
                                                    padding: '2px 6px',
                                                    borderRadius: '4px',
                                                }}
                                            >
                                                {user.name}
                                                {user.status === 'busy' && ' 🔴'}
                                                {user.isMenuOpen && ' 📋'}
                                            </span>
                                        </>
                                    ) : (
                                        <div
                                            style={{
                                                backgroundColor: '#4263eb',
                                                color: 'white',
                                                padding: '4px 8px',
                                                borderRadius: '12px',
                                                fontSize: '12px',
                                                whiteSpace: 'nowrap',
                                            }}
                                        >
                                            {user.name}
                                        </div>
                                    )}
                                </div>
                            );
                        }),
                [users, currentUser?.id, canvasOffset],
            )}

            {/* Local Avatar Cursor - カスタムカーソル選択時のみ表示 */}
            <AvatarCursor
                cursorState={cursorState}
                userStatus={_userStatus}
                mousePosition={mousePosition}
                canvasOffset={canvasOffset}
                showRadialMenu={showRadialMenu}
            />

            {/* Radial Menu */}
            {radialMenuPosition && (
                <RadialMenu
                    key={`${radialMenuPosition.x}-${radialMenuPosition.y}`}
                    position={radialMenuPosition}
                    items={radialMenuItems}
                    onClose={() => setRadialMenuPosition(null)}
                />
            )}

            {/* Floating Emojis */}
            <EmojiFloat emojis={floatingEmojis} onComplete={handleEmojiComplete} />
        </>
    );
};
