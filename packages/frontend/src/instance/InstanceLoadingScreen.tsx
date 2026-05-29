import { css, cx } from '@/styled-system/css';
import type { LoadingStage, StageStatus } from './useInstanceLoading';

interface InstanceLoadingScreenProps {
    worldName?: string;
    thumbnail?: string;
    progress: number;
    stages: LoadingStage[];
    fadingOut: boolean;
    failed: boolean;
    failureMessage: string | null;
    onReturnToLobby: () => void;
}

function StageIcon({ status }: { status: StageStatus }) {
    if (status === 'done') {
        return (
            <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                aria-hidden
            >
                <path d="M20 6 9 17l-5-5" />
            </svg>
        );
    }
    if (status === 'error') {
        return (
            <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                aria-hidden
            >
                <path d="M18 6 6 18M6 6l12 12" />
            </svg>
        );
    }
    if (status === 'active') {
        return (
            <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                aria-hidden
                className={css({ animation: 'spin 0.8s linear infinite' })}
            >
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
        );
    }
    // pending
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <circle cx="12" cy="12" r="9" />
        </svg>
    );
}

// ステータスごとの色（Panda トークンは静的に解決させるため css() を事前生成）
const iconColorClass: Record<StageStatus, string> = {
    done: css({ color: 'success' }),
    active: css({ color: 'white' }),
    error: css({ color: 'errorLight' }),
    pending: css({ color: 'hudTextSubtle' }),
};
const labelColorClass: Record<StageStatus, string> = {
    done: css({ color: 'rgba(255, 255, 255, 0.92)' }),
    active: css({ color: 'white', fontWeight: '700' }),
    error: css({ color: 'errorLight', fontWeight: '700' }),
    pending: css({ color: 'rgba(255, 255, 255, 0.45)' }),
};

/**
 * インスタンス接続のロード画面。段階別ステータスと総合進捗バーを表示し、
 * 失敗時はロビーへ戻る導線を出す。
 */
export function InstanceLoadingScreen({
    worldName,
    thumbnail,
    progress,
    stages,
    fadingOut,
    failed,
    failureMessage,
    onReturnToLobby,
}: InstanceLoadingScreenProps) {
    return (
        <div
            className={css({
                position: 'fixed',
                inset: 0,
                zIndex: 9999,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: 'primary',
                color: 'white',
                gap: '24px',
                px: '6',
                transition: 'opacity 500ms ease-in-out',
            })}
            style={{
                opacity: fadingOut ? 0 : 1,
                pointerEvents: fadingOut ? 'none' : 'auto',
            }}
        >
            {thumbnail ? (
                <img
                    src={thumbnail}
                    alt=""
                    className={css({
                        width: '120px',
                        height: '120px',
                        objectFit: 'cover',
                        borderRadius: '24px',
                        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
                    })}
                />
            ) : (
                <div
                    className={css({
                        width: '120px',
                        height: '120px',
                        borderRadius: '24px',
                        backgroundColor: 'rgba(255, 255, 255, 0.1)',
                    })}
                />
            )}

            <h2 className={css({ fontSize: '22px', fontWeight: 'bold', letterSpacing: '0.04em', textAlign: 'center' })}>
                {worldName || (failed ? '接続に失敗しました' : '接続中...')}
            </h2>

            {failed ? (
                <div
                    className={css({
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: '16px',
                        maxWidth: '420px',
                    })}
                >
                    <p
                        className={css({
                            fontSize: '14px',
                            color: 'errorLight',
                            textAlign: 'center',
                            lineHeight: 1.6,
                        })}
                    >
                        {failureMessage ?? '不明なエラーが発生しました'}
                    </p>
                    <button
                        type="button"
                        onClick={onReturnToLobby}
                        className={css({
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '8px',
                            px: '20px',
                            py: '10px',
                            bg: 'white',
                            color: 'primary',
                            border: 'none',
                            borderRadius: '12px',
                            fontSize: '14px',
                            fontWeight: '700',
                            cursor: 'pointer',
                            transition: 'opacity 0.15s ease',
                            _hover: { opacity: 0.85 },
                        })}
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
                        ロビーに戻る
                    </button>
                </div>
            ) : (
                <div
                    className={css({
                        width: 'full',
                        maxWidth: '360px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '20px',
                    })}
                >
                    {/* 総合進捗バー */}
                    <div className={css({ display: 'flex', flexDirection: 'column', gap: '8px' })}>
                        <div
                            className={css({
                                width: 'full',
                                height: '6px',
                                backgroundColor: 'rgba(255, 255, 255, 0.18)',
                                borderRadius: 'full',
                                overflow: 'hidden',
                            })}
                        >
                            <div
                                className={css({
                                    height: '100%',
                                    backgroundColor: 'white',
                                    borderRadius: 'full',
                                    transition: 'width 0.3s ease',
                                })}
                                style={{ width: `${progress}%` }}
                            />
                        </div>
                        <span
                            className={css({
                                fontSize: '12px',
                                fontFamily: 'mono',
                                color: 'rgba(255, 255, 255, 0.6)',
                                textAlign: 'right',
                            })}
                        >
                            {progress}%
                        </span>
                    </div>

                    {/* 段階別ステータス */}
                    <ul
                        className={css({
                            listStyle: 'none',
                            m: 0,
                            p: 0,
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '10px',
                        })}
                    >
                        {stages.map((stage) => (
                            <li
                                key={stage.id}
                                className={css({
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '10px',
                                    fontSize: '14px',
                                })}
                            >
                                <span
                                    className={cx(
                                        css({ display: 'flex', flexShrink: 0, width: '18px', height: '18px' }),
                                        iconColorClass[stage.status],
                                    )}
                                >
                                    <StageIcon status={stage.status} />
                                </span>
                                <span className={cx(css({ flex: 1 }), labelColorClass[stage.status])}>
                                    {stage.label}
                                </span>
                                {stage.detail && (
                                    <span
                                        className={css({
                                            fontSize: '12px',
                                            fontFamily: 'mono',
                                            color: 'rgba(255, 255, 255, 0.55)',
                                        })}
                                    >
                                        {stage.detail}
                                    </span>
                                )}
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
}
