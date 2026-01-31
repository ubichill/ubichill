'use client';

import type { Instance } from '@ubichill/shared';
import { css } from '@/styled-system/css';

interface InstanceCardProps {
    instance: Instance;
    onJoin: (instanceId: string) => void;
}

export function InstanceCard({ instance, onJoin }: InstanceCardProps) {
    const statusColors: Record<string, string> = {
        active: '#40c057',
        full: '#fab005',
        closing: '#868e96',
    };

    return (
        <div
            className={css({
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '16px',
                backgroundColor: 'white',
                border: '1px solid #e9ecef',
                borderRadius: '12px',
                transition: 'all 0.2s ease',
                _hover: {
                    boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
                },
            })}
        >
            <div className={css({ display: 'flex', alignItems: 'center', gap: '16px' })}>
                <div
                    className={css({
                        width: '48px',
                        height: '48px',
                        borderRadius: '10px',
                        backgroundColor: '#f1f3f5',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '24px',
                    })}
                >
                    🏠
                </div>
                <div>
                    <h3
                        className={css({
                            fontSize: '15px',
                            fontWeight: '600',
                            color: '#212529',
                            marginBottom: '4px',
                        })}
                    >
                        {instance.room.displayName}
                    </h3>
                    <div
                        className={css({
                            display: 'flex',
                            alignItems: 'center',
                            gap: '12px',
                            fontSize: '13px',
                            color: '#868e96',
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
                    padding: '10px 20px',
                    backgroundColor: '#228BE6',
                    color: 'white',
                    border: 'none',
                    borderRadius: '8px',
                    fontSize: '14px',
                    fontWeight: '500',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    _hover: {
                        backgroundColor: '#1c7ed6',
                    },
                    _disabled: {
                        backgroundColor: '#dee2e6',
                        cursor: 'not-allowed',
                    },
                })}
            >
                参加
            </button>
        </div>
    );
}
