import { useEffect } from 'react';
import { InstanceCard } from '@/components/lobby/InstanceCard';
import { useInstances } from '@/components/lobby/useInstances';
import { css } from '@/styled-system/css';
import { cardBase, cardStyle, type JoinInstanceHandler, sectionHeading, tabPanel } from './shared';

interface HomeTabProps {
    onJoinInstance: JoinInstanceHandler;
    /** 現在参加中のインスタンスID（一覧で「参加中」表示にする） */
    currentInstanceId?: string;
    /** ロビーへ戻る操作（インスタンス内のみ表示） */
    onReturnToLobby?: () => void;
}

export function HomeTab({ onJoinInstance, currentInstanceId, onReturnToLobby }: HomeTabProps) {
    const { instances, loading, error, refreshInstances } = useInstances();

    useEffect(() => {
        void refreshInstances();
    }, [refreshInstances]);

    return (
        <div className={tabPanel} onClick={(e) => e.stopPropagation()}>
            {onReturnToLobby && (
                <button
                    type="button"
                    onClick={onReturnToLobby}
                    className={css({
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '8px',
                        alignSelf: 'flex-start',
                        px: '14px',
                        py: '9px',
                        bg: 'surfaceAccent',
                        color: 'text',
                        border: 'none',
                        borderRadius: '12px',
                        fontSize: '13px',
                        fontWeight: '600',
                        cursor: 'pointer',
                        boxShadow: 'card',
                        _hover: { opacity: 0.9 },
                    })}
                >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M15 18l-6-6 6-6" />
                    </svg>
                    ロビーへ戻る
                </button>
            )}
            <div className={cardStyle}>
                <h2 className={sectionHeading}>オンラインのフレンド</h2>
                <div
                    className={css({
                        p: '6',
                        bg: 'secondary',
                        borderRadius: '12px',
                        textAlign: 'center',
                        color: 'textMuted',
                        fontSize: '15px',
                    })}
                >
                    Coming Soon...
                </div>
            </div>

            <div className={css(cardBase, { flex: 1 })}>
                <h2 className={sectionHeading}>アクティブなインスタンス</h2>
                {loading && instances.length === 0 ? (
                    <div className={css({ textAlign: 'center', p: '4', color: 'textMuted' })}>読み込み中...</div>
                ) : error ? (
                    <div className={css({ p: '4', bg: 'errorBg', color: 'errorText', borderRadius: '8px' })}>
                        {error}
                    </div>
                ) : instances.length === 0 ? (
                    <div
                        className={css({
                            textAlign: 'center',
                            p: '6',
                            bg: 'secondary',
                            borderRadius: '12px',
                            color: 'textMuted',
                        })}
                    >
                        アクティブなインスタンスはありません
                    </div>
                ) : (
                    <div className={css({ display: 'flex', flexDirection: 'column', gap: '3' })}>
                        {instances.map((instance) => (
                            <InstanceCard
                                key={instance.id}
                                instance={instance}
                                isCurrent={instance.id === currentInstanceId}
                                onJoin={(id) =>
                                    onJoinInstance(id, instance.world.id, {
                                        thumbnail: instance.world.thumbnail,
                                        displayName: instance.world.displayName,
                                    })
                                }
                            />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
