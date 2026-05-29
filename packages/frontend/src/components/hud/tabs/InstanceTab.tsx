import { useSocket } from '@ubichill/sdk/react';
import type { Instance } from '@ubichill/shared';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useInstances } from '@/components/lobby/useInstances';
import { useConfirm } from '@/components/ui/ConfirmProvider';
import { API_BASE } from '@/lib/api';
import { css } from '@/styled-system/css';
import { cardStyle, sectionHeading, tabPanel } from './shared';

interface InstanceTabProps {
    currentInstanceId: string;
    onNavigate?: () => void;
    onReturnToLobby?: () => void;
}

const actionButtonBase = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    px: '16px',
    py: '11px',
    borderRadius: '12px',
    border: 'none',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'opacity 0.15s ease',
    _hover: { opacity: 0.9 },
    _disabled: { opacity: 0.5, cursor: 'not-allowed' },
};

/**
 * 現在参加中のインスタンスの詳細タブ。
 * 入り直し / 新規インスタンス作成 / (作者のみ)編集 / ロビーへ戻る と、参加者一覧を表示する。
 */
export function InstanceTab({ currentInstanceId, onNavigate, onReturnToLobby }: InstanceTabProps) {
    const navigate = useNavigate();
    const confirm = useConfirm();
    const { users, currentUser } = useSocket();
    const { createInstance } = useInstances();

    const [instance, setInstance] = useState<Instance | null>(null);
    const [creating, setCreating] = useState(false);

    useEffect(() => {
        let cancelled = false;
        fetch(`${API_BASE}/api/v1/instances/${currentInstanceId}`, { credentials: 'include' })
            .then((r) => (r.ok ? (r.json() as Promise<Instance>) : null))
            .then((data) => {
                if (!cancelled && data) setInstance(data);
            })
            .catch(() => {
                /* 取得失敗時はアクション一部のみ非表示 */
            });
        return () => {
            cancelled = true;
        };
    }, [currentInstanceId]);

    const world = instance?.world ?? null;
    const isAuthor = !!world && !!currentUser && world.authorId === currentUser.id;

    const handleReenter = async () => {
        if (!(await confirm('このインスタンスに入り直しますか？'))) return;
        // 同一インスタンスへの入り直しは join 処理を最初からやり直す必要があるためリロードする
        window.location.reload();
    };

    const handleCreateNew = async () => {
        if (!world || creating) return;
        if (!(await confirm('新しいインスタンスを作成して移動しますか？'))) return;
        setCreating(true);
        try {
            const created = await createInstance({ worldId: world.id });
            if (created) {
                onNavigate?.();
                navigate(`/instance/${created.id}`, {
                    state: {
                        worldId: created.world.id,
                        worldData: { thumbnail: created.world.thumbnail, displayName: created.world.displayName },
                    },
                });
            }
        } finally {
            setCreating(false);
        }
    };

    const handleEdit = async () => {
        if (!world) return;
        if (!(await confirm('ワールドの編集画面に移動しますか？'))) return;
        onNavigate?.();
        navigate(`/world/${world.id}/edit`);
    };

    const participants = [...users.values()];

    return (
        <div className={tabPanel} onClick={(e) => e.stopPropagation()}>
            {/* インスタンス概要 + アクション */}
            <div className={cardStyle}>
                <div className={css({ display: 'flex', alignItems: 'center', gap: '4', mb: '5' })}>
                    <div
                        className={css({
                            width: { base: '56px', md: '72px' },
                            height: { base: '56px', md: '72px' },
                            borderRadius: '16px',
                            overflow: 'hidden',
                            bg: 'secondary',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                        })}
                    >
                        {world?.thumbnail ? (
                            <img
                                src={world.thumbnail}
                                alt=""
                                className={css({ width: '100%', height: '100%', objectFit: 'cover' })}
                            />
                        ) : (
                            <svg
                                width="28"
                                height="28"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.5"
                                className={css({ color: 'textSubtle' })}
                            >
                                <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z" />
                                <circle cx="12" cy="10" r="3" />
                            </svg>
                        )}
                    </div>
                    <div className={css({ minW: 0, flex: 1 })}>
                        <p
                            className={css({
                                fontSize: '11px',
                                fontWeight: '700',
                                color: 'textSubtle',
                                textTransform: 'uppercase',
                                letterSpacing: '0.08em',
                                mb: '1',
                            })}
                        >
                            現在のインスタンス
                        </p>
                        <h2
                            className={css({
                                fontSize: { base: 'lg', md: 'xl' },
                                fontWeight: '700',
                                color: 'text',
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                            })}
                        >
                            {world?.displayName ?? '読み込み中...'}
                        </h2>
                        <p className={css({ fontSize: '12px', color: 'textMuted', mt: '1' })}>
                            {participants.length} 人が参加中
                        </p>
                    </div>
                </div>

                <div
                    className={css({
                        display: 'grid',
                        gridTemplateColumns: { base: '1fr', sm: '1fr 1fr' },
                        gap: '2',
                    })}
                >
                    <button
                        type="button"
                        onClick={() => void handleReenter()}
                        className={css(actionButtonBase, { bg: 'secondary', color: 'text' })}
                    >
                        <svg
                            width="16"
                            height="16"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                        >
                            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                            <path d="M3 3v5h5" />
                        </svg>
                        入り直す
                    </button>
                    <button
                        type="button"
                        onClick={() => void handleCreateNew()}
                        disabled={!world || creating}
                        className={css(actionButtonBase, { bg: 'primary', color: 'textOnPrimary' })}
                    >
                        <svg
                            width="16"
                            height="16"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                        >
                            <path d="M12 5v14M5 12h14" />
                        </svg>
                        {creating ? '作成中...' : '新しいインスタンス'}
                    </button>
                    {isAuthor && (
                        <button
                            type="button"
                            onClick={() => void handleEdit()}
                            className={css(actionButtonBase, { bg: 'secondary', color: 'text' })}
                        >
                            <svg
                                width="16"
                                height="16"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                            >
                                <path d="M12 20h9" />
                                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
                            </svg>
                            編集
                        </button>
                    )}
                    {onReturnToLobby && (
                        <button
                            type="button"
                            onClick={onReturnToLobby}
                            className={css(actionButtonBase, { bg: 'secondary', color: 'text' })}
                        >
                            <svg
                                width="16"
                                height="16"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                            >
                                <path d="M15 18l-6-6 6-6" />
                            </svg>
                            ロビーへ戻る
                        </button>
                    )}
                </div>
            </div>

            {/* 参加者一覧 */}
            <div className={cardStyle}>
                <h2 className={sectionHeading}>参加者一覧</h2>
                <ul
                    className={css({
                        listStyle: 'none',
                        m: 0,
                        p: 0,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '2',
                    })}
                >
                    {participants.map((user) => (
                        <li
                            key={user.id}
                            className={css({
                                display: 'flex',
                                alignItems: 'center',
                                gap: '10px',
                                p: '8px 10px',
                                borderRadius: '10px',
                                bg: 'surface',
                            })}
                        >
                            <span
                                className={css({
                                    width: '32px',
                                    height: '32px',
                                    borderRadius: '50%',
                                    bg: 'primary',
                                    color: 'textOnPrimary',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    fontSize: '13px',
                                    fontWeight: '700',
                                    flexShrink: 0,
                                    textTransform: 'uppercase',
                                })}
                            >
                                {user.name.charAt(0)}
                            </span>
                            <span
                                className={css({
                                    flex: 1,
                                    fontSize: '14px',
                                    color: 'text',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                })}
                            >
                                {user.name}
                                {user.id === currentUser?.id && (
                                    <span className={css({ ml: '6px', fontSize: '11px', color: 'textSubtle' })}>
                                        (あなた)
                                    </span>
                                )}
                            </span>
                        </li>
                    ))}
                </ul>
            </div>
        </div>
    );
}
