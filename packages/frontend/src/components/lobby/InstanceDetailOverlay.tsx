import { type Instance, worldSourceLabel } from '@ubichill/shared';
import { useNavigate } from 'react-router';
import { css } from '@/styled-system/css';

interface InstanceDetailOverlayProps {
    instance: Instance;
    onClose: () => void;
    /** このインスタンスに入る（＝参加）。 */
    onJoin: (instanceId: string) => void;
    /** 現在参加中のインスタンスか。 */
    isCurrent?: boolean;
}

/**
 * インスタンス詳細のオーバーレイ。
 * インスタンス一覧の行クリックで開く。**ルート遷移せず**（インスタンス内で見たまま）、
 * そのインスタンスのワールド情報・人数・アクセス種別を見せて「入る」できる。
 * ワールドそのものの詳細ページ（公開・ログイン不要）へは別途リンクする。
 */
export function InstanceDetailOverlay({ instance, onClose, onJoin, isCurrent = false }: InstanceDetailOverlayProps) {
    const navigate = useNavigate();
    const { world, stats, access, status } = instance;
    const full = status === 'full' || status === 'closing';

    return (
        <div
            role="presentation"
            onClick={onClose}
            className={css({
                position: 'fixed',
                inset: 0,
                bg: 'rgba(0,0,0,0.5)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 1000,
                p: '4',
            })}
        >
            <div
                role="dialog"
                aria-modal="true"
                onClick={(e) => e.stopPropagation()}
                className={css({
                    width: 'full',
                    maxW: 'md',
                    bg: 'surface',
                    borderRadius: '16px',
                    border: '1px solid',
                    borderColor: 'border',
                    overflow: 'hidden',
                    boxShadow: 'card',
                })}
            >
                <div
                    className={css({
                        width: 'full',
                        aspectRatio: '16 / 9',
                        bg: 'secondary',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                    })}
                >
                    {world.thumbnail ? (
                        <img
                            src={world.thumbnail}
                            alt={world.displayName}
                            className={css({ width: '100%', height: '100%', objectFit: 'cover' })}
                        />
                    ) : (
                        <span className={css({ color: 'textSubtle', fontSize: 'sm' })}>No thumbnail</span>
                    )}
                </div>

                <div className={css({ p: '5', display: 'flex', flexDir: 'column', gap: '3' })}>
                    <h2 className={css({ fontSize: 'lg', fontWeight: 'bold', color: 'text' })}>{world.displayName}</h2>

                    <div className={css({ display: 'flex', gap: '2', flexWrap: 'wrap', fontSize: 'xs' })}>
                        {world.source && (
                            <span
                                className={css({
                                    px: '2',
                                    py: '1',
                                    bg: 'primarySubtle',
                                    borderRadius: '4px',
                                    color: 'textMuted',
                                })}
                            >
                                {worldSourceLabel(world.source)}
                            </span>
                        )}
                        <span
                            className={css({
                                px: '2',
                                py: '1',
                                bg: 'secondary',
                                borderRadius: '4px',
                                color: 'textMuted',
                            })}
                        >
                            {access.type === 'public'
                                ? '公開'
                                : access.type === 'friend_only'
                                  ? 'フレンド限定'
                                  : '招待制'}
                            {access.password ? ' · パスワードあり' : ''}
                        </span>
                        <span
                            className={css({
                                px: '2',
                                py: '1',
                                bg: 'secondary',
                                borderRadius: '4px',
                                color: 'textMuted',
                            })}
                        >
                            {stats.currentUsers} / {stats.maxUsers} 人
                        </span>
                    </div>

                    <div className={css({ display: 'flex', gap: '2', mt: '2' })}>
                        {isCurrent ? (
                            <span
                                className={css({
                                    flex: 1,
                                    textAlign: 'center',
                                    py: '3',
                                    bg: 'successBg',
                                    color: 'success',
                                    borderRadius: '10px',
                                    fontWeight: '600',
                                })}
                            >
                                参加中
                            </span>
                        ) : (
                            <button
                                type="button"
                                onClick={() => onJoin(instance.id)}
                                disabled={full}
                                className={css({
                                    flex: 1,
                                    py: '3',
                                    bg: 'primary',
                                    color: 'textOnPrimary',
                                    border: 'none',
                                    borderRadius: '10px',
                                    fontWeight: '600',
                                    cursor: 'pointer',
                                    _hover: { opacity: 0.9 },
                                    _disabled: { opacity: 0.5, cursor: 'not-allowed' },
                                })}
                            >
                                {full ? '満員' : '入る'}
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={() => navigate(`/world/${world.id}`)}
                            className={css({
                                py: '3',
                                px: '4',
                                bg: 'secondary',
                                color: 'text',
                                border: '1px solid',
                                borderColor: 'border',
                                borderRadius: '10px',
                                fontWeight: '600',
                                cursor: 'pointer',
                                whiteSpace: 'nowrap',
                                _hover: { bg: 'surfaceHover' },
                            })}
                        >
                            ワールド詳細
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
