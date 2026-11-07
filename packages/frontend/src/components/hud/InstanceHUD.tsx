import { useSocket } from '@ubichill/react';
import { useState } from 'react';
import { useParams } from 'react-router';
import { useNotifications } from '@/components/notifications';
import { css } from '@/styled-system/css';
import { HudIcon } from './HudIcon';
import { HudOverlay } from './HudOverlay';

/**
 * インスタンス内の常時表示 HUD。ボタン 1 つで、ランチパッド（ホーム・リスポーンなどの操作とドックの画面）を開く。
 */
export function InstanceHUD() {
    const { id: instanceId } = useParams<{ id: string }>();
    const { isConnected } = useSocket();
    const [open, setOpen] = useState(false);
    const unread = useNotifications().feed.unreadCount > 0;

    return (
        <>
            {/* ランチパッドを開くボタン（PC は右上・スマホは右下） */}
            <button
                type="button"
                onClick={() => setOpen(true)}
                aria-label={unread ? 'ランチパッドを開く（未読の通知あり）' : 'ランチパッドを開く'}
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
                <HudIcon name="rocket" size={24} />
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
                {/* 未読の通知 */}
                {unread && (
                    <span
                        aria-hidden="true"
                        className={css({
                            position: 'absolute',
                            bottom: '6px',
                            right: '6px',
                            width: '8px',
                            height: '8px',
                            borderRadius: '50%',
                            backgroundColor: 'warning',
                        })}
                    />
                )}
            </button>

            {open && instanceId && <HudOverlay currentInstanceId={instanceId} onClose={() => setOpen(false)} />}
        </>
    );
}
