'use client';

import { useState } from 'react';
import { css } from '@/styled-system/css';
import { useInstances } from '@/core/hooks/useInstances';
import { RoomCard } from './RoomCard';
import { InstanceCard } from './InstanceCard';

type LobbyView = 'instances' | 'rooms';

interface LobbyProps {
    userName: string;
    onJoinInstance: (instanceId: string, roomId: string) => void;
}

export function Lobby({ userName, onJoinInstance }: LobbyProps) {
    const { instances, rooms, loading, error, createInstance, refreshInstances } = useInstances();
    const [view, setView] = useState<LobbyView>('instances');

    const handleCreateFromRoom = async (roomId: string) => {
        const instance = await createInstance({ roomId });
        if (instance) {
            onJoinInstance(instance.id, roomId);
        }
    };

    const handleJoinInstance = (instanceId: string) => {
        const instance = instances.find((i) => i.id === instanceId);
        if (instance) {
            onJoinInstance(instanceId, instance.room.id);
        }
    };

    return (
        <div
            className={css({
                maxWidth: '800px',
                margin: '0 auto',
                padding: '40px 24px',
            })}
        >
            {/* Header */}
            <div
                className={css({
                    textAlign: 'center',
                    marginBottom: '40px',
                })}
            >
                <h1
                    className={css({
                        fontSize: '32px',
                        fontWeight: '700',
                        color: '#212529',
                        marginBottom: '8px',
                    })}
                >
                    ようこそ、{userName}さん！
                </h1>
                <p
                    className={css({
                        fontSize: '16px',
                        color: '#868e96',
                    })}
                >
                    インスタンスに参加するか、新しいルームを作成しましょう
                </p>
            </div>

            {/* Tab Navigation */}
            <div
                className={css({
                    display: 'flex',
                    gap: '8px',
                    marginBottom: '24px',
                    padding: '4px',
                    backgroundColor: '#f1f3f5',
                    borderRadius: '10px',
                })}
            >
                <button
                    type="button"
                    onClick={() => setView('instances')}
                    className={css({
                        flex: 1,
                        padding: '12px 16px',
                        backgroundColor: view === 'instances' ? 'white' : 'transparent',
                        color: view === 'instances' ? '#212529' : '#868e96',
                        border: 'none',
                        borderRadius: '8px',
                        fontSize: '14px',
                        fontWeight: '500',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                        boxShadow: view === 'instances' ? '0 2px 4px rgba(0,0,0,0.05)' : 'none',
                    })}
                >
                    🎮 参加可能なインスタンス ({instances.length})
                </button>
                <button
                    type="button"
                    onClick={() => setView('rooms')}
                    className={css({
                        flex: 1,
                        padding: '12px 16px',
                        backgroundColor: view === 'rooms' ? 'white' : 'transparent',
                        color: view === 'rooms' ? '#212529' : '#868e96',
                        border: 'none',
                        borderRadius: '8px',
                        fontSize: '14px',
                        fontWeight: '500',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                        boxShadow: view === 'rooms' ? '0 2px 4px rgba(0,0,0,0.05)' : 'none',
                    })}
                >
                    ➕ 新規作成 ({rooms.length})
                </button>
            </div>

            {/* Error */}
            {error && (
                <div
                    className={css({
                        padding: '12px 16px',
                        backgroundColor: '#fff5f5',
                        color: '#c92a2a',
                        borderRadius: '8px',
                        marginBottom: '24px',
                        fontSize: '14px',
                    })}
                >
                    {error}
                </div>
            )}

            {/* Loading */}
            {loading && (
                <div
                    className={css({
                        textAlign: 'center',
                        padding: '40px',
                        color: '#868e96',
                    })}
                >
                    読み込み中...
                </div>
            )}

            {/* Content */}
            {view === 'instances' && (
                <div className={css({ display: 'flex', flexDirection: 'column', gap: '12px' })}>
                    {instances.length === 0 ? (
                        <div
                            className={css({
                                textAlign: 'center',
                                padding: '60px 24px',
                                backgroundColor: '#f8f9fa',
                                borderRadius: '12px',
                            })}
                        >
                            <p
                                className={css({
                                    fontSize: '48px',
                                    marginBottom: '16px',
                                })}
                            >
                                🏠
                            </p>
                            <p
                                className={css({
                                    fontSize: '16px',
                                    color: '#868e96',
                                    marginBottom: '16px',
                                })}
                            >
                                参加可能なインスタンスがありません
                            </p>
                            <button
                                type="button"
                                onClick={() => setView('rooms')}
                                className={css({
                                    padding: '12px 24px',
                                    backgroundColor: '#228BE6',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '8px',
                                    fontSize: '14px',
                                    fontWeight: '500',
                                    cursor: 'pointer',
                                })}
                            >
                                新規作成
                            </button>
                        </div>
                    ) : (
                        <>
                            <div
                                className={css({
                                    display: 'flex',
                                    justifyContent: 'flex-end',
                                    marginBottom: '8px',
                                })}
                            >
                                <button
                                    type="button"
                                    onClick={() => refreshInstances()}
                                    className={css({
                                        padding: '8px 12px',
                                        backgroundColor: 'transparent',
                                        color: '#868e96',
                                        border: '1px solid #dee2e6',
                                        borderRadius: '6px',
                                        fontSize: '13px',
                                        cursor: 'pointer',
                                        _hover: { backgroundColor: '#f8f9fa' },
                                    })}
                                >
                                    🔄 更新
                                </button>
                            </div>
                            {instances.map((instance) => (
                                <InstanceCard key={instance.id} instance={instance} onJoin={handleJoinInstance} />
                            ))}
                        </>
                    )}
                </div>
            )}

            {view === 'rooms' && (
                <div>
                    <p
                        className={css({
                            fontSize: '14px',
                            color: '#868e96',
                            marginBottom: '16px',
                        })}
                    >
                        テンプレートを選択して新しいインスタンスを作成します
                    </p>
                    <div
                        className={css({
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
                            gap: '16px',
                        })}
                    >
                        {rooms.map((room) => (
                            <RoomCard key={room.id} room={room} onSelect={handleCreateFromRoom} />
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
