import type { Instance } from '@ubichill/shared';
import { css } from '@/styled-system/css';

interface InstanceCardProps {
    instance: Instance;
    onJoin: (instanceId: string) => void;
    /** 現在参加中のインスタンスかどうか */
    isCurrent?: boolean;
}

export function InstanceCard({ instance, onJoin, isCurrent = false }: InstanceCardProps) {
    const statusColors: Record<string, string> = {
        active: '#8ad29b', // success token value
        full: '#f1c86c', // warning token value
        closing: '#9ea7bd', // info token value
    };

    return (
        <div
            className={css({
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: { base: '12px', md: '16px' },
                backgroundColor: isCurrent ? 'successBg' : 'surface',
                borderRadius: '14px',
                border: '1px solid',
                borderColor: isCurrent ? 'success' : 'border',
                transition: 'background-color 0.16s ease',
                _hover: {
                    backgroundColor: isCurrent ? 'successBg' : 'surfaceHover',
                },
            })}
        >
            <div className={css({ display: 'flex', alignItems: 'center', gap: { base: '3', md: '4' }, minW: 0 })}>
                {/* ワールドサムネイル（インスタンス一覧でも一目で分かるように） */}
                <div
                    className={css({
                        width: { base: '44px', md: '56px' },
                        height: { base: '44px', md: '56px' },
                        borderRadius: '10px',
                        overflow: 'hidden',
                        flexShrink: 0,
                        backgroundColor: 'secondary',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                    })}
                >
                    {instance.world.thumbnail ? (
                        <img
                            src={instance.world.thumbnail}
                            alt={instance.world.displayName}
                            className={css({ width: '100%', height: '100%', objectFit: 'cover' })}
                        />
                    ) : (
                        <svg
                            width="20"
                            height="20"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            aria-hidden="true"
                            className={css({ color: 'textSubtle' })}
                        >
                            <circle cx="12" cy="12" r="10" />
                            <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                        </svg>
                    )}
                </div>
                <div className={css({ minW: 0 })}>
                    <h3
                        className={css({
                            fontSize: { base: '14px', md: '16px' },
                            fontWeight: '600',
                            color: 'text',
                            marginBottom: '4px',
                        })}
                    >
                        {instance.world.displayName}
                    </h3>
                    <div
                        className={css({
                            display: 'flex',
                            alignItems: 'center',
                            gap: '12px',
                            flexWrap: 'wrap',
                            fontSize: '13px',
                            color: 'textMuted',
                        })}
                    >
                        <span
                            className={css({
                                display: 'flex',
                                alignItems: 'center',
                                gap: '4px',
                            })}
                        >
                            <span
                                style={{
                                    width: '8px',
                                    height: '8px',
                                    borderRadius: '50%',
                                    backgroundColor: statusColors[instance.status] || '#868e96',
                                }}
                            />
                            {instance.status}
                        </span>
                        <span className={css({ display: 'flex', alignItems: 'center', gap: '4px' })}>
                            <svg
                                width="14"
                                height="14"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                aria-hidden="true"
                            >
                                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                                <circle cx="9" cy="7" r="4" />
                                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                            </svg>
                            {instance.stats.currentUsers}/{instance.stats.maxUsers}
                        </span>
                        {instance.access.password && (
                            <svg
                                width="14"
                                height="14"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                aria-label="パスワード保護"
                            >
                                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                            </svg>
                        )}
                    </div>
                </div>
            </div>
            {isCurrent ? (
                <span
                    className={css({
                        padding: { base: '8px 14px', md: '10px 18px' },
                        backgroundColor: '#8ad29b1a',
                        color: '#8ad29b',
                        border: '1px solid #8ad29b44',
                        borderRadius: '10px',
                        fontSize: '14px',
                        fontWeight: '600',
                        whiteSpace: 'nowrap',
                    })}
                >
                    参加中
                </span>
            ) : (
                <button
                    type="button"
                    onClick={() => onJoin(instance.id)}
                    disabled={instance.status === 'full' || instance.status === 'closing'}
                    className={css({
                        padding: { base: '8px 14px', md: '10px 18px' },
                        backgroundColor: 'primary',
                        color: 'textOnPrimary',
                        border: 'none',
                        borderRadius: '10px',
                        fontSize: '14px',
                        fontWeight: '600',
                        cursor: 'pointer',
                        transition: 'opacity 0.16s ease',
                        _hover: {
                            opacity: 0.9,
                        },
                        _disabled: {
                            backgroundColor: 'primarySubtle',
                            color: 'textSubtle',
                            cursor: 'not-allowed',
                        },
                    })}
                >
                    参加
                </button>
            )}
        </div>
    );
}
