import type { CursorState, UserStatus } from '@ubichill/sdk';
import { usePluginWorker, useSocket } from '@ubichill/sdk/react';
import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import { avatarPluginCode } from './AvatarBehaviour';

export interface AvatarCursorProps {
    cursorState: CursorState;
    userStatus: UserStatus;
    mousePosition: { x: number; y: number };
    showRadialMenu?: boolean;
}

/**
 * AvatarCursor - ローカルユーザーのカスタムカーソルの描画とロジックを管理します。
 *
 * プラグインコードはStringとして Worker に注入され、実際の座標計算は
 * Sandbox Worker 内で行われます。HOSTは LIFECYCLE_TICK イベントと
 * CUSTOM イベント（SET_TARGET_POSITION）をWorkerへ送信し、
 * WorkerからはSCENE_UPDATE_CURSOR コマンドを受け取ります。
 */
export const AvatarCursor: React.FC<AvatarCursorProps> = ({
    cursorState,
    userStatus,
    mousePosition,
    showRadialMenu = false,
}) => {
    const { currentUser } = useSocket();
    const [fixedAvatarPosition, setFixedAvatarPosition] = useState<{ x: number; y: number } | null>(null);
    const previousStatusRef = useRef<UserStatus>(userStatus);
    const previousMenuRef = useRef<boolean>(showRadialMenu);
    const cursorRef = useRef<HTMLDivElement>(null);

    const [smoothPosition, setSmoothPosition] = useState(mousePosition);

    // ステータス変化でカーソル位置をロック
    useEffect(() => {
        if (userStatus === 'busy' && previousStatusRef.current !== 'busy') {
            setFixedAvatarPosition({ ...mousePosition });
        } else if (userStatus !== 'busy' && previousStatusRef.current === 'busy') {
            setFixedAvatarPosition(null);
        }
        previousStatusRef.current = userStatus;
    }, [userStatus, mousePosition]);

    // ラジアルメニュー表示でカーソル位置をロック
    useEffect(() => {
        if (showRadialMenu && !previousMenuRef.current) {
            setFixedAvatarPosition({ ...mousePosition });
        } else if (!showRadialMenu && previousMenuRef.current && userStatus !== 'busy') {
            setFixedAvatarPosition(null);
        }
        previousMenuRef.current = showRadialMenu;
    }, [showRadialMenu, mousePosition, userStatus]);

    const { sendEvent } = usePluginWorker({
        pluginCode: avatarPluginCode,
        handlers: {
            onCommand: (cmd) => {
                if (cmd.type === 'SCENE_UPDATE_CURSOR') {
                    setSmoothPosition({ x: cmd.payload.x, y: cmd.payload.y });
                }
            },
        },
    });

    // マウス位置の変更をWorkerへ送信（EVT_CUSTOM 経由）
    useEffect(() => {
        const targetPos =
            (userStatus === 'busy' || showRadialMenu) && fixedAvatarPosition ? fixedAvatarPosition : mousePosition;

        sendEvent({
            type: 'EVT_CUSTOM',
            payload: { eventType: 'SET_TARGET_POSITION', data: targetPos },
        });
    }, [mousePosition, userStatus, fixedAvatarPosition, showRadialMenu, sendEvent]);

    // カーソル画像の取得
    const localAvatar = currentUser?.avatar || { states: {} };
    const currentLocalAvatar = localAvatar.states[cursorState] || localAvatar.states.default;
    const localAvatarUrl = currentLocalAvatar?.url;
    const localHotspot = currentLocalAvatar?.hotspot || { x: 0, y: 0 };

    // システムカーソルの非表示
    useEffect(() => {
        if (localAvatarUrl && localAvatar.hideSystemCursor) {
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
        } else {
            document.body.classList.remove('cursor-hidden');
        }

        return () => {
            document.body.classList.remove('cursor-hidden');
            const existingStyle = document.getElementById('cursor-none-style');
            if (existingStyle) existingStyle.remove();
        };
    }, [localAvatarUrl, localAvatar.hideSystemCursor]);

    if (!localAvatarUrl) return null;

    return (
        <div
            ref={cursorRef}
            style={{
                position: 'fixed',
                left: 0,
                top: 0,
                transform: `translate3d(${smoothPosition.x - localHotspot.x - (typeof window !== 'undefined' ? window.scrollX : 0)}px, ${smoothPosition.y - localHotspot.y - (typeof window !== 'undefined' ? window.scrollY : 0)}px, 0)`,
                pointerEvents: 'none',
                zIndex: 9999,
                willChange: 'transform',
            }}
        >
            <img
                src={localAvatarUrl}
                alt="avatar cursor"
                style={{
                    maxWidth: '64px',
                    maxHeight: '64px',
                    width: 'auto',
                    height: 'auto',
                    display: 'block',
                }}
            />
            {userStatus === 'busy' && (
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
        </div>
    );
};
