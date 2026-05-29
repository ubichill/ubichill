import { useSocket } from '@ubichill/sdk/react';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lobby } from '@/components/lobby';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { css } from '@/styled-system/css';

interface WorldListModalProps {
    /** モーダルを閉じるコールバック */
    onClose: () => void;
    /** 現在参加中のインスタンスID */
    currentInstanceId: string;
}

/**
 * フルスクリーンのワールド一覧モーダル。
 * HUD メニューから呼び出され、別インスタンスへの移動を提供する。
 */
export function WorldListModal({ onClose, currentInstanceId }: WorldListModalProps) {
    const navigate = useNavigate();
    const { leaveWorld } = useSocket();

    // フェードインアニメーション用の状態
    const [visible, setVisible] = useState(false);
    const [confirmingInstance, setConfirmingInstance] = useState<{
        instanceId: string;
        worldId: string;
        worldData?: { thumbnail?: string; displayName?: string };
    } | null>(null);

    useEffect(() => {
        // マウント直後にフェードイン開始
        requestAnimationFrame(() => setVisible(true));
    }, []);

    // ESC キーでモーダルを閉じる
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                onClose();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onClose]);

    // インスタンス参加ハンドラ — 確認後にナビゲーションで移動
    const handleJoinInstance = useCallback(
        (instanceId: string, worldId: string, worldData?: { thumbnail?: string; displayName?: string }) => {
            // 現在のインスタンスと同じ場合はモーダルを閉じるだけ
            if (instanceId === currentInstanceId) {
                onClose();
                return;
            }

            setConfirmingInstance({ instanceId, worldId, worldData });
        },
        [currentInstanceId, onClose],
    );

    return (
        // オーバーレイ背景 — クリックでモーダルを閉じる
        <div
            className={css({
                position: 'fixed',
                inset: 0,
                zIndex: 10010,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'opacity 0.2s ease',
            })}
            style={{
                backgroundColor: 'rgba(0, 0, 0, 0.7)',
                backdropFilter: 'blur(4px)',
                WebkitBackdropFilter: 'blur(4px)',
                opacity: visible ? 1 : 0,
            }}
            onClick={onClose}
        >
            {/* コンテンツエリア — クリックの伝播を止める */}
            <div
                className={css({
                    width: '100%',
                    maxWidth: '800px',
                    maxHeight: '90vh',
                    mx: '4',
                    bg: 'surfaceAccent',
                    borderRadius: '24px',
                    overflow: 'hidden',
                    display: 'flex',
                    flexDirection: 'column',
                    transition: 'opacity 0.2s ease, transform 0.2s ease',
                })}
                style={{
                    opacity: visible ? 1 : 0,
                    transform: visible ? 'scale(1)' : 'scale(0.96)',
                }}
                onClick={(e) => e.stopPropagation()}
            >
                {/* ヘッダー: 閉じるボタン */}
                <div
                    className={css({
                        display: 'flex',
                        justifyContent: 'flex-end',
                        p: '3',
                        flexShrink: 0,
                    })}
                >
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="閉じる"
                        className={css({
                            width: '36px',
                            height: '36px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            bg: 'secondary',
                            color: 'text',
                            border: 'none',
                            borderRadius: '10px',
                            cursor: 'pointer',
                            fontSize: '18px',
                            lineHeight: 1,
                            _hover: { opacity: 0.8 },
                        })}
                    >
                        ✕
                    </button>
                </div>

                {/* Lobby コンテンツ（スクロール可能） */}
                <div
                    className={css({
                        flex: 1,
                        minH: 0,
                        overflowY: 'auto',
                        px: { base: '4', md: '6' },
                        pb: '6',
                        '&::-webkit-scrollbar': {
                            width: '6px',
                        },
                        '&::-webkit-scrollbar-track': {
                            backgroundColor: 'transparent',
                        },
                        '&::-webkit-scrollbar-thumb': {
                            backgroundColor: 'primarySubtle',
                            borderRadius: '3px',
                        },
                    })}
                >
                    <Lobby onJoinInstance={handleJoinInstance} mode="modal" currentInstanceId={currentInstanceId} />
                </div>
            </div>

            {/* 確認モーダル */}
            <ConfirmModal
                isOpen={confirmingInstance !== null}
                message="このインスタンスに移動しますか？現在のインスタンスから退出します。"
                onConfirm={() => {
                    if (!confirmingInstance) return;
                    leaveWorld().then(() => {
                        navigate(`/instance/${confirmingInstance.instanceId}`, {
                            state: {
                                worldId: confirmingInstance.worldId,
                                worldData: confirmingInstance.worldData,
                            },
                        });
                        onClose();
                    });
                }}
                onCancel={() => setConfirmingInstance(null)}
            />
        </div>
    );
}
