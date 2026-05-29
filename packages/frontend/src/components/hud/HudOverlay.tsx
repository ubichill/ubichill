import { useSocket } from '@ubichill/sdk/react';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useConfirm } from '@/components/ui/ConfirmProvider';
import { css } from '@/styled-system/css';
import { type HudTabId, HudTabs } from './HudTabs';

interface HudOverlayProps {
    /** オーバーレイを閉じるコールバック */
    onClose: () => void;
    /** 現在参加中のインスタンスID */
    currentInstanceId: string;
    /** 初期表示タブ */
    initialTab?: HudTabId;
}

/**
 * インスタンス内から開く HUD オーバーレイ。
 * ホーム / ワールド / フレンド / マイページのタブをロビーと共通化し、別インスタンスへの移動も提供する。
 * 背景（ポップアップの周囲）をクリックすると閉じる。
 */
export function HudOverlay({ onClose, currentInstanceId, initialTab = 'worlds' }: HudOverlayProps) {
    const navigate = useNavigate();
    const confirm = useConfirm();
    const { leaveWorld } = useSocket();

    // フェードインアニメーション用の状態
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        // マウント直後にフェードイン開始
        requestAnimationFrame(() => setVisible(true));
    }, []);

    // ESC キーでオーバーレイを閉じる
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
        async (instanceId: string, worldId: string, worldData?: { thumbnail?: string; displayName?: string }) => {
            // 現在のインスタンスと同じ場合は閉じるだけ
            if (instanceId === currentInstanceId) {
                onClose();
                return;
            }

            if (!(await confirm('このインスタンスに移動しますか？現在のインスタンスから退出します。'))) return;

            // 確実に古いインスタンスから退出してから新しいインスタンスへ移動する
            await leaveWorld();
            navigate(`/instance/${instanceId}`, { state: { worldId, worldData } });
            onClose();
        },
        [currentInstanceId, navigate, onClose, leaveWorld, confirm],
    );

    // ロビーへ戻る — 確認後に退出して遷移（ホーム/現在地タブのボタンから呼ばれる）
    const handleReturnToLobby = useCallback(async () => {
        if (!(await confirm('ロビーへ戻りますか？現在のインスタンスから退出します。'))) return;
        await leaveWorld();
        navigate('/');
        onClose();
    }, [confirm, leaveWorld, navigate, onClose]);

    return (
        // オーバーレイ背景 — ポップアップの周囲をクリックで閉じる
        <div
            className={css({
                position: 'fixed',
                inset: 0,
                zIndex: 10010,
                display: 'flex',
                flexDirection: 'column',
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
            <HudTabs
                onJoinInstance={handleJoinInstance}
                currentInstanceId={currentInstanceId}
                initialTab={initialTab}
                onNavigate={onClose}
                onReturnToLobby={() => void handleReturnToLobby()}
            />
        </div>
    );
}
