import { useSocket } from '@ubichill/react';
import { useState } from 'react';
import { useParams } from 'react-router';
import { css } from '@/styled-system/css';
import { HudOverlay } from './HudOverlay';

/**
 * インスタンス内の常時表示 HUD。
 * Mac の Launchpad のようなグリッドアイコン1つで、押すとタブ付きオーバーレイを開く。
 * ロビーへ戻る等の操作はオーバーレイ内のタブ（ホーム/現在地）に集約している。
 */
export function InstanceHUD() {
    const { id: instanceId } = useParams<{ id: string }>();
    const { isConnected } = useSocket();
    const [open, setOpen] = useState(false);

    return (
        <>
            {/* Launchpad ボタン（右下固定） */}
            <button
                type="button"
                onClick={() => setOpen(true)}
                aria-label="メニューを開く"
                className={css({
                    position: 'fixed',
                    top: { base: 'auto', md: '20px' },
                    bottom: { base: '20px', md: 'auto' },
                    right: '20px',
                    width: '52px',
                    height: '52px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: 'hudBg',
                    backdropFilter: 'blur(8px)',
                    borderRadius: '16px',
                    border: 'none',
                    cursor: 'pointer',
                    color: 'hudText',
                    zIndex: 10000,
                    boxShadow: '0 6px 20px rgba(0,0,0,0.35)',
                    transition: 'background-color 0.15s ease, transform 0.15s ease',
                    _hover: { backgroundColor: 'hudBgHover', transform: 'translateY(-2px)' },
                })}
            >
                {/* 3x3 グリッドの Launchpad 風アイコン */}
                <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    {[4, 10.5, 17].flatMap((y) =>
                        [4, 10.5, 17].map((x) => <rect key={`${x}-${y}`} x={x} y={y} width="3" height="3" rx="1" />),
                    )}
                </svg>
                {/* 接続インジケーター */}
                <span
                    className={css({
                        position: 'absolute',
                        top: '6px',
                        right: '6px',
                        width: '8px',
                        height: '8px',
                        borderRadius: '50%',
                        border: '1.5px solid',
                        borderColor: 'hudBg',
                        backgroundColor: isConnected ? 'hudStatusOn' : 'hudStatusOff',
                    })}
                />
            </button>

            {/* タブ付きオーバーレイ（ホーム / 現在地 / ワールド / フレンド / マイページ） */}
            {open && instanceId && (
                <HudOverlay currentInstanceId={instanceId} initialTab="home" onClose={() => setOpen(false)} />
            )}
        </>
    );
}
