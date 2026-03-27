import type { AppAvatarDef, CursorState, UserStatus } from '@ubichill/sdk';
import { useCursorPosition, usePluginWorker } from '@ubichill/sdk/react';
import type React from 'react';
import { useEffect, useRef } from 'react';
import { avatarPluginCode } from './AvatarBehaviour.gen';

type AvatarPayloads = {
    'cursor:position': { x: number; y: number };
};

export interface AvatarCursorProps {
    cursorState: CursorState;
    userStatus: UserStatus;
    showRadialMenu?: boolean;
    localAvatar: AppAvatarDef;
}

/**
 * AvatarCursor - ローカルユーザーのカスタムカーソルの描画を担当します。
 *
 * マウス入力は InputCollector が毎フレーム全 Worker へ自動配信するため、
 * Frontend からマウス座標を送信するコードは不要です。
 * Worker が EcsEventType.INPUT_MOUSE_MOVE で座標を受け取り、
 * lerp 補間後に Ubi.network.sendToHost('cursor:position') で位置を返します。
 *
 * このコンポーネントの責務:
 *   - Worker の起動と onMessage 受信（描画位置の更新）
 *   - busy ステータス / ラジアルメニュー時のロック状態を Worker に通知
 *   - カーソル画像の描画
 *   - システムカーソルの制御
 */
export const AvatarCursor: React.FC<AvatarCursorProps> = ({
    cursorState,
    userStatus,
    showRadialMenu = false,
    localAvatar,
}) => {
    const currentLocalAvatar = localAvatar.states[cursorState] || localAvatar.states.default;
    const localAvatarUrl = currentLocalAvatar?.url;
    const localHotspot = currentLocalAvatar?.hotspot || { x: 0, y: 0 };

    // DOM 直接書き込みで re-render ゼロのカーソル位置更新
    const { divRef, onCursorUpdate } = useCursorPosition({ hotspot: localHotspot });

    const { sendEvent } = usePluginWorker<AvatarPayloads>({
        pluginCode: avatarPluginCode,
        handlers: {
            onMessage: (msg) => {
                if (msg.type === 'cursor:position') {
                    onCursorUpdate(msg.payload.x, msg.payload.y);
                }
            },
        },
    });

    // busy ステータスまたはラジアルメニュー表示中は入力をロック
    const locked = userStatus === 'busy' || showRadialMenu;
    const prevLockedRef = useRef(locked);
    useEffect(() => {
        if (locked === prevLockedRef.current) return;
        prevLockedRef.current = locked;
        sendEvent({ type: 'EVT_CUSTOM', payload: { eventType: 'avatar:lock', data: { locked } } });
    }, [locked, sendEvent]);

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
            ref={divRef}
            style={{
                position: 'fixed',
                left: 0,
                top: 0,
                visibility: 'hidden',
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
