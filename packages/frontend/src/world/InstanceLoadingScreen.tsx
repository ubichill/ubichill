import { useState } from 'react';
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
    recoveryLabel: string;
    onRecover: () => void;
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

/** 横向きで背の低い画面（横にしたスマホなど）。縦に積むと操作が画面の外に出るので、サムネイルと横に並べる */
const SHORT_LANDSCAPE = '@media (orientation: landscape) and (max-height: 600px)';

/**
 * ワールドのサムネイル。読み込みの中でいちばん先に取りに行き（fetchPriority high）、届いたら出す。
 * 後ろには同じ画像をぼかして敷く（2 枚目は同じ URL なのでもう一度は取りに行かない）。
 */
function WorldThumbnail({ src }: { src: string }) {
    const [state, setState] = useState<'loading' | 'loaded' | 'failed'>('loading');
    // 読めなければ場所も空けない（名前と進み具合だけにする）
    if (state === 'failed') return null;
    const loaded = state === 'loaded';
    return (
        <>
            <img
                src={src}
                alt=""
                aria-hidden="true"
                className={css({
                    position: 'fixed',
                    inset: '-40px',
                    width: 'calc(100% + 80px)',
                    maxWidth: 'none',
                    height: 'calc(100% + 80px)',
                    objectFit: 'cover',
                    filter: 'blur(28px) brightness(0.45)',
                    transition: 'opacity 400ms ease',
                    pointerEvents: 'none',
                })}
                style={{ opacity: loaded ? 1 : 0 }}
            />
            <img
                src={src}
                alt=""
                fetchPriority="high"
                decoding="async"
                onLoad={() => setState('loaded')}
                onError={() => setState('failed')}
                className={css({
                    position: 'relative',
                    flexShrink: 0,
                    width: 'min(640px, 100%, calc(45dvh * 16 / 9))',
                    aspectRatio: '16 / 9',
                    objectFit: 'cover',
                    borderRadius: '16px',
                    boxShadow: 'modal',
                    bg: 'hudActionHover',
                    transition: 'opacity 400ms ease',
                    [SHORT_LANDSCAPE]: { width: 'min(640px, 50%, calc((100dvh - 32px) * 16 / 9))' },
                })}
                style={{ opacity: loaded ? 1 : 0 }}
            />
        </>
    );
}

/**
 * インスタンス接続のロード画面。ワールドのサムネイルを先に出し、段階別ステータスと総合進捗バーを表示する。
 * 失敗時はホームへ戻る導線を出す。
 */
export function InstanceLoadingScreen({
    worldName,
    thumbnail,
    progress,
    stages,
    fadingOut,
    failed,
    failureMessage,
    recoveryLabel,
    onRecover,
}: InstanceLoadingScreenProps) {
    return (
        <div
            className={css({
                position: 'fixed',
                inset: 0,
                zIndex: 9999,
                display: 'flex',
                flexDirection: 'column',
                backgroundColor: 'primary',
                color: 'white',
                overflowX: 'hidden',
                overflowY: 'auto',
                transition: 'opacity 500ms ease-in-out',
            })}
            style={{
                opacity: fadingOut ? 0 : 1,
                pointerEvents: fadingOut ? 'none' : 'auto',
            }}
        >
            {/* 中央寄せは my: auto で行う（justify center だと、収まらないとき上が画面外に切れてスクロールでも届かない） */}
            <div
                className={css({
                    my: 'auto',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '24px',
                    px: '6',
                    py: '6',
                    [SHORT_LANDSCAPE]: { flexDirection: 'row', gap: '32px', py: '4' },
                })}
            >
                {thumbnail && <WorldThumbnail key={thumbnail} src={thumbnail} />}

                <div
                    className={css({
                        position: 'relative',
                        width: 'full',
                        maxWidth: '420px',
                        minWidth: 0,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: '24px',
                        [SHORT_LANDSCAPE]: { gap: '16px' },
                    })}
                >
                    <h2
                        className={css({
                            fontSize: '22px',
                            fontWeight: 'bold',
                            letterSpacing: '0.04em',
                            textAlign: 'center',
                        })}
                    >
                        {worldName || (failed ? '接続に失敗しました' : '接続中...')}
                    </h2>

                    {failed ? (
                        <div
                            className={css({
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                gap: '16px',
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
                                onClick={onRecover}
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
                                {recoveryLabel}
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
            </div>
        </div>
    );
}
