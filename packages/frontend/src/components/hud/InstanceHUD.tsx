import { useSocket } from '@ubichill/sdk/react';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { css } from '@/styled-system/css';
import { HudOverlay } from './HudOverlay';
import type { HudTabId } from './HudTabs';

const pillBase = {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '7px 12px',
    backgroundColor: 'hudBg',
    backdropFilter: 'blur(6px)',
    borderRadius: '20px',
    border: 'none',
    cursor: 'pointer',
    color: 'hudText',
    fontSize: '13px',
    fontWeight: '500',
    transition: 'background-color 0.15s ease',
    _hover: { backgroundColor: 'hudBgHover' },
};

export function InstanceHUD() {
    const navigate = useNavigate();
    const { id: instanceId } = useParams<{ id: string }>();
    const { users, isConnected, currentUser, leaveWorld } = useSocket();
    const [menuOpen, setMenuOpen] = useState(false);
    /** オーバーレイで開くタブ。null のとき非表示 */
    const [overlayTab, setOverlayTab] = useState<HudTabId | null>(null);

    const userCount = users.size;
    const myName = currentUser?.name ?? '';

    const handleReturnToLobby = async () => {
        setMenuOpen(false);
        await leaveWorld();
        navigate('/');
    };

    return (
        <>
            {/* 常時表示の HUD クラスタ（右上・縦並び）。上から アカウント / メニュー / 参加者 */}
            <div
                className={css({
                    position: 'fixed',
                    top: '12px',
                    right: '12px',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-end',
                    gap: '8px',
                    zIndex: 10000,
                    pointerEvents: 'auto',
                })}
            >
                {/* アカウント → マイページ */}
                <button
                    type="button"
                    onClick={() => setOverlayTab('profile')}
                    className={css({ ...pillBase, maxWidth: '200px' })}
                    aria-label="マイページを開く"
                >
                    <span
                        className={css({
                            width: '22px',
                            height: '22px',
                            borderRadius: '50%',
                            backgroundColor: 'hudAvatar',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '11px',
                            fontWeight: '700',
                            color: 'white',
                            flexShrink: 0,
                            textTransform: 'uppercase',
                        })}
                    >
                        {myName.charAt(0) || '?'}
                    </span>
                    <span
                        className={css({
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                        })}
                    >
                        {myName || 'マイページ'}
                    </span>
                </button>

                {/* メニューを開く */}
                <button
                    type="button"
                    onClick={() => setMenuOpen((o) => !o)}
                    className={css(pillBase)}
                    aria-label="メニューを開く"
                    aria-expanded={menuOpen}
                >
                    <span className={css({ display: 'flex', flexDirection: 'column', gap: '3px' })}>
                        {[0, 1, 2].map((i) => (
                            <span
                                key={i}
                                className={css({
                                    display: 'block',
                                    width: '14px',
                                    height: '2px',
                                    backgroundColor: 'hudText',
                                    borderRadius: '1px',
                                })}
                            />
                        ))}
                    </span>
                    メニュー
                </button>

                {/* 参加者 → 現在地（インスタンス）タブ */}
                <button
                    type="button"
                    onClick={() => setOverlayTab('instance')}
                    className={css(pillBase)}
                    aria-label="参加者を見る"
                >
                    <span
                        className={css({
                            width: '7px',
                            height: '7px',
                            borderRadius: '50%',
                            flexShrink: 0,
                            backgroundColor: isConnected ? 'hudStatusOn' : 'hudStatusOff',
                        })}
                    />
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                        <circle cx="9" cy="7" r="4" />
                        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                    </svg>
                    {userCount}
                </button>
            </div>

            {/* メニューパネル（ロビーへ戻る等。ロビーは今後廃止予定） */}
            {menuOpen && (
                <>
                    <div
                        className={css({ position: 'fixed', inset: 0, zIndex: 10001 })}
                        onClick={() => setMenuOpen(false)}
                    />
                    <div
                        className={css({
                            position: 'fixed',
                            top: '52px',
                            right: '12px',
                            width: '220px',
                            backgroundColor: 'hudPanel',
                            backdropFilter: 'blur(12px)',
                            borderRadius: '14px',
                            border: '1px solid',
                            borderColor: 'hudBorder',
                            overflow: 'hidden',
                            zIndex: 10002,
                            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
                            padding: '8px',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '2px',
                        })}
                    >
                        <button
                            type="button"
                            onClick={() => void handleReturnToLobby()}
                            className={css({
                                width: 'full',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                padding: '9px 12px',
                                backgroundColor: 'transparent',
                                border: 'none',
                                borderRadius: '8px',
                                cursor: 'pointer',
                                color: 'hudTextAction',
                                fontSize: '13px',
                                fontWeight: '500',
                                transition: 'background-color 0.12s ease',
                                _hover: { backgroundColor: 'hudActionHover' },
                            })}
                        >
                            <span className={css({ fontSize: '16px', lineHeight: 1 })}>←</span>
                            ロビーへ戻る
                        </button>
                    </div>
                </>
            )}

            {/* HUD オーバーレイ（現在地 / ホーム / ワールド / フレンド / マイページ） */}
            {overlayTab && instanceId && (
                <HudOverlay
                    currentInstanceId={instanceId}
                    initialTab={overlayTab}
                    onClose={() => setOverlayTab(null)}
                />
            )}
        </>
    );
}
