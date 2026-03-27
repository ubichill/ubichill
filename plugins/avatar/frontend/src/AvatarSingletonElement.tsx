'use client';

import type { AppAvatarDef, CursorState, UserStatus } from '@ubichill/sdk';
import type { UbiInstanceContext } from '@ubichill/sdk/ui';
import { UbiSingleton } from '@ubichill/sdk/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Root } from 'react-dom/client';
import { createRoot } from 'react-dom/client';
import { AvatarCursor } from './AvatarCursor';
import { CursorMenu } from './components/CursorMenu';
import { EmojiFloat, type FloatingEmoji } from './components/EmojiFloat';
import { RadialMenu, type RadialMenuItem } from './components/RadialMenu';

// ============================================
// useCursorState（DOM の computed style からカーソル種別を検知）
// ============================================

const useCursorState = (): CursorState => {
    const [cursorState, setCursorState] = useState<CursorState>('default');

    useEffect(() => {
        let lastElement: Element | null = null;

        const checkCursor = (e: MouseEvent) => {
            const target = e.target as Element;
            if (!target || target === lastElement) return;
            lastElement = target;

            const style = window.getComputedStyle(target);
            const cursor = style.cursor;
            let newState: CursorState = 'default';

            if (cursor === 'none' || cursor === 'auto') {
                let current: Element | null = target;
                while (current) {
                    const tagName = current.tagName.toLowerCase();
                    const role = current.getAttribute('role');
                    const type = current.getAttribute('type');
                    const contentEditable = current.getAttribute('contenteditable');

                    if (
                        tagName === 'a' ||
                        tagName === 'button' ||
                        role === 'button' ||
                        role === 'link' ||
                        current.hasAttribute('onclick')
                    ) {
                        newState = 'pointer';
                        break;
                    } else if (
                        (tagName === 'input' &&
                            (type === 'text' || type === 'email' || type === 'password' || !type)) ||
                        tagName === 'textarea' ||
                        contentEditable === 'true'
                    ) {
                        newState = 'text';
                        break;
                    } else if (window.getComputedStyle(current).cursor === 'pointer') {
                        newState = 'pointer';
                        break;
                    }

                    if (current === document.body) break;
                    current = current.parentElement;
                }
            } else {
                if (cursor === 'pointer') newState = 'pointer';
                else if (cursor === 'text') newState = 'text';
                else if (cursor === 'wait' || cursor === 'progress') newState = 'wait';
                else if (cursor === 'help') newState = 'help';
                else if (cursor === 'not-allowed' || cursor === 'no-drop') newState = 'not-allowed';
                else if (cursor === 'move') newState = 'move';
                else if (cursor === 'grabbing') newState = 'grabbing';
            }

            setCursorState(newState);
        };

        window.addEventListener('mouseover', checkCursor);
        return () => window.removeEventListener('mouseover', checkCursor);
    }, []);

    return cursorState;
};

// ============================================
// AvatarSingletonContent（React コンポーネント）
// ============================================

const AvatarSingletonContent: React.FC<{ ctx: UbiInstanceContext }> = ({ ctx }) => {
    const { currentUser, users, updateUser, updatePosition, socket } = ctx;
    const cursorState = useCursorState();

    const [userStatus, setUserStatus] = useState<UserStatus>('online');
    const [cursorLockPosition, setCursorLockPosition] = useState<{ x: number; y: number } | null>(null);
    const [radialMenuPosition, setRadialMenuPosition] = useState<{ x: number; y: number } | null>(null);
    const [floatingEmojis, setFloatingEmojis] = useState<FloatingEmoji[]>([]);
    const [localAvatar, _setLocalAvatar] = useState<AppAvatarDef>(() => currentUser?.avatar ?? { states: {} });
    const [hasUserModifiedAvatar, setHasUserModifiedAvatar] = useState(false);

    const menuOpenPositionRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
    const lastPositionRef = useRef({ x: 0, y: 0, time: 0 });
    const POSITION_THROTTLE = 50;

    const showRadialMenu = radialMenuPosition !== null;

    const setLocalAvatar = (value: AppAvatarDef | ((prev: AppAvatarDef) => AppAvatarDef)) => {
        setHasUserModifiedAvatar(true);
        _setLocalAvatar(value as AppAvatarDef);
    };

    // サーバーからのアバター同期
    useEffect(() => {
        if (currentUser?.avatar && !hasUserModifiedAvatar) {
            _setLocalAvatar(currentUser.avatar);
        }
    }, [currentUser?.avatar, hasUserModifiedAvatar]);

    useEffect(() => {
        if (!currentUser?.id || !hasUserModifiedAvatar) return;
        if (JSON.stringify(currentUser.avatar) !== JSON.stringify(localAvatar)) {
            updateUser({ avatar: localAvatar });
        }
    }, [localAvatar, currentUser?.id, updateUser, currentUser?.avatar, hasUserModifiedAvatar]);

    // マウス位置の追跡とカーソル位置の送信
    useEffect(() => {
        const handlePointerMove = (e: PointerEvent) => {
            const now = Date.now();
            if (now - lastPositionRef.current.time < POSITION_THROTTLE) return;

            let x = e.clientX + window.scrollX;
            let y = e.clientY + window.scrollY;

            if (userStatus === 'busy' && cursorLockPosition) {
                x = cursorLockPosition.x;
                y = cursorLockPosition.y;
            }

            lastPositionRef.current = { x, y, time: now };
            updatePosition({ x, y }, cursorState);
        };

        window.addEventListener('pointermove', handlePointerMove);
        return () => window.removeEventListener('pointermove', handlePointerMove);
    }, [userStatus, cursorLockPosition, cursorState, updatePosition]);

    // 右クリックでラジアルメニューを開く
    useEffect(() => {
        const handleContextMenu = (e: MouseEvent) => {
            e.preventDefault();
            const screenPos = { x: e.clientX, y: e.clientY };
            setRadialMenuPosition(screenPos);
            menuOpenPositionRef.current = { x: e.clientX + window.scrollX, y: e.clientY + window.scrollY };
            updateUser({ isMenuOpen: true });
        };

        window.addEventListener('contextmenu', handleContextMenu);
        return () => window.removeEventListener('contextmenu', handleContextMenu);
    }, [updateUser]);

    // 絵文字ブロードキャスト受信
    useEffect(() => {
        if (!socket) return;
        const handler = (payload: { entityId: string; data: unknown }) => {
            const data = payload.data as {
                emoji: string;
                position: { x: number; y: number };
                userId: string;
                timestamp: number;
            };
            if (!data || data.userId === currentUser?.id) return;
            setFloatingEmojis((prev) => [
                ...prev,
                {
                    id: `${data.timestamp}-${data.userId}`,
                    emoji: data.emoji,
                    position: data.position,
                    timestamp: data.timestamp,
                },
            ]);
        };
        const h = handler as (...args: unknown[]) => void;
        socket.on('entity:ephemeral', h);
        return () => socket.off('entity:ephemeral', h);
    }, [socket, currentUser?.id]);

    useEffect(() => {
        if (!showRadialMenu) {
            menuOpenPositionRef.current = lastPositionRef.current;
        }
    }, [showRadialMenu]);

    const changeStatus = useCallback(
        (newStatus: UserStatus) => {
            setUserStatus(newStatus);
            if (newStatus === 'busy') {
                setCursorLockPosition({ ...lastPositionRef.current });
            } else {
                setCursorLockPosition(null);
            }
            updateUser({ status: newStatus, isMenuOpen: false });
            setRadialMenuPosition(null);
        },
        [updateUser],
    );

    const sendEmoji = useCallback(
        (emoji: string) => {
            if (!currentUser?.id || !socket) return;
            const pos = showRadialMenu ? menuOpenPositionRef.current : lastPositionRef.current;
            const newEmoji: FloatingEmoji = {
                id: Date.now().toString(),
                emoji,
                position: pos,
                timestamp: Date.now(),
            };
            setFloatingEmojis((prev) => [...prev, newEmoji]);
            socket.emit('entity:ephemeral', {
                entityId: 'emoji-broadcast',
                data: { emoji, position: pos, userId: currentUser.id, timestamp: Date.now() },
            });
            setRadialMenuPosition(null);
            updateUser({ isMenuOpen: false });
        },
        [currentUser?.id, socket, showRadialMenu, updateUser],
    );

    const handleEmojiComplete = useCallback((id: string) => {
        setFloatingEmojis((prev) => prev.filter((e) => e.id !== id));
    }, []);

    const radialMenuItems: RadialMenuItem[] = useMemo(
        () => [
            {
                id: 'emoji',
                label: '絵文字',
                icon: '😊',
                submenu: [
                    { id: 'emoji-thumbsup', label: 'いいね', icon: '👍', action: () => sendEmoji('👍') },
                    { id: 'emoji-heart', label: 'ハート', icon: '❤️', action: () => sendEmoji('❤️') },
                    { id: 'emoji-laugh', label: '笑い', icon: '😂', action: () => sendEmoji('😂') },
                    { id: 'emoji-clap', label: '拍手', icon: '👏', action: () => sendEmoji('👏') },
                    { id: 'emoji-fire', label: '炎', icon: '🔥', action: () => sendEmoji('🔥') },
                    { id: 'emoji-thinking', label: '考え中', icon: '🤔', action: () => sendEmoji('🤔') },
                ],
            },
            {
                id: 'status',
                label: 'ステータス',
                icon: '🟢',
                submenu: [
                    { id: 'status-online', label: 'オンライン', icon: '🟢', action: () => changeStatus('online') },
                    { id: 'status-busy', label: '作業中', icon: '🔴', action: () => changeStatus('busy') },
                    { id: 'status-dnd', label: '起こさないで', icon: '🔕', action: () => changeStatus('dnd') },
                ],
            },
        ],
        [sendEmoji, changeStatus],
    );

    return (
        <>
            {/* カーソルメニュー（アバター設定）*/}
            <div
                style={{
                    position: 'fixed',
                    top: '16px',
                    right: '16px',
                    zIndex: 9998,
                    maxWidth: '400px',
                    maxHeight: 'calc(100vh - 32px)',
                    overflowY: 'auto',
                    pointerEvents: 'auto',
                }}
            >
                <CursorMenu avatar={localAvatar} onAvatarChange={setLocalAvatar} />
            </div>

            {/* リモートユーザーのアバター */}
            {Array.from(users.values())
                .filter((user) => user.id !== currentUser?.id)
                .map((user) => {
                    const remoteCursorState = user.cursorState || 'default';
                    const userAvatarState = user.avatar?.states?.[remoteCursorState] || user.avatar?.states?.default;
                    const remoteUrl = userAvatarState?.url;
                    const remoteHotspot = userAvatarState?.hotspot || { x: 0, y: 0 };
                    const displayPosition = user.position;

                    return (
                        <div
                            key={user.id}
                            style={{
                                position: 'fixed',
                                pointerEvents: 'none',
                                zIndex: 10000,
                                left:
                                    displayPosition.x -
                                    remoteHotspot.x -
                                    (typeof window !== 'undefined' ? window.scrollX : 0),
                                top:
                                    displayPosition.y -
                                    remoteHotspot.y -
                                    (typeof window !== 'undefined' ? window.scrollY : 0),
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
                })}

            {/* ローカルカーソル */}
            <AvatarCursor
                cursorState={cursorState}
                userStatus={userStatus}
                showRadialMenu={showRadialMenu}
                localAvatar={localAvatar}
            />

            {/* ラジアルメニュー */}
            {radialMenuPosition && (
                <div style={{ pointerEvents: 'auto' }}>
                    <RadialMenu
                        key={`${radialMenuPosition.x}-${radialMenuPosition.y}`}
                        position={radialMenuPosition}
                        items={radialMenuItems}
                        onClose={() => setRadialMenuPosition(null)}
                    />
                </div>
            )}

            {/* フローティング絵文字 */}
            <EmojiFloat emojis={floatingEmojis} onComplete={handleEmojiComplete} />
        </>
    );
};

// ============================================
// Custom Element
// ============================================

export class AvatarSingletonElement extends UbiSingleton {
    #root: Root | null = null;

    connectedCallback() {
        this.#root = createRoot(this);
    }

    protected onUpdate(ctx: UbiInstanceContext) {
        this.#root?.render(<AvatarSingletonContent ctx={ctx} />);
    }

    disconnectedCallback() {
        const root = this.#root;
        this.#root = null;
        setTimeout(() => root?.unmount(), 0);
    }
}
