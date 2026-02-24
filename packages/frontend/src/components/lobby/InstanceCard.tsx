'use client';

import type { Instance } from '@ubichill/shared';
import { css } from '@/styled-system/css';

interface InstanceCardProps {
    instance: Instance;
    onJoin: (instanceId: string) => void;
}

export function InstanceCard({ instance, onJoin }: InstanceCardProps) {
    const statusColors: Record<string, string> = {
        active: '#8ad29b',
        full: '#f1c86c',
        closing: '#9ea7bd',
    };

    return (
        <div
            className={css({
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: { base: '12px', md: '16px' },
                backgroundColor: '#1d3054',
                borderRadius: '14px',
                transition: 'background-color 0.16s ease',
                _hover: {
                    backgroundColor: '#243b66',
                },
            })}
        >
            <div className={css({ display: 'flex', alignItems: 'center', gap: { base: '3', md: '4' } })}>
                <div>
                    <h3
                        className={css({
                            fontSize: { base: '14px', md: '16px' },
                            fontWeight: '600',
                            color: '#e9ddcb',
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
                            color: '#d8cfbf',
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
                        <span>
                            👥 {instance.stats.currentUsers}/{instance.stats.maxUsers}
                        </span>
                        {instance.access.password && <span>🔒</span>}
                    </div>
                </div>
            </div>
            <button
                type="button"
                onClick={() => onJoin(instance.id)}
                disabled={instance.status === 'full' || instance.status === 'closing'}
                className={css({
                    padding: { base: '8px 14px', md: '10px 18px' },
                    backgroundColor: '#e6d8c5',
                    color: '#1a2a45',
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
                        backgroundColor: 'rgba(230, 216, 197, 0.35)',
                        color: '#93a0ba',
                        cursor: 'not-allowed',
                    },
                })}
            >
                参加
            </button>
        </div>
    );
}
