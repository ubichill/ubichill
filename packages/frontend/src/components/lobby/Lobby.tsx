'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useInstances } from '@/core/hooks/useInstances';
import { css } from '@/styled-system/css';
import { InstanceCard } from './InstanceCard';
import { WorldCard } from './WorldCard';

type LobbyView = 'instances' | 'worlds';

interface LobbyProps {
    userName: string;
    onJoinInstance: (instanceId: string, worldId: string) => void;
}

export function Lobby({ userName, onJoinInstance }: LobbyProps) {
    const { instances, worlds, loading, error, createInstance, refreshInstances, refreshWorlds } = useInstances();
    const [view, setView] = useState<LobbyView>('instances');

    // Pull-to-refresh state
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [pullOffset, setPullOffset] = useState(0);
    const pullStartY = useRef(0);
    const isPulling = useRef(false);
    const scrollRef = useRef<HTMLDivElement>(null);

    const PULL_THRESHOLD = 60;

    // Refresh current view data
    const refreshCurrentView = useCallback(async () => {
        setIsRefreshing(true);
        try {
            if (view === 'instances') {
                await refreshInstances();
            } else {
                await refreshWorlds();
            }
        } finally {
            setIsRefreshing(false);
        }
    }, [view, refreshInstances, refreshWorlds]);

    // Refresh data when switching tabs
    const handleTabSwitch = useCallback(
        async (newView: LobbyView) => {
            if (newView === view) return;
            setView(newView);
            setIsRefreshing(true);
            try {
                if (newView === 'instances') {
                    await refreshInstances();
                } else {
                    await refreshWorlds();
                }
            } finally {
                setIsRefreshing(false);
            }
        },
        [view, refreshInstances, refreshWorlds],
    );

    // Touch-based pull-to-refresh
    const handleTouchStart = useCallback((e: React.TouchEvent) => {
        if (scrollRef.current && scrollRef.current.scrollTop <= 0) {
            pullStartY.current = e.touches[0].clientY;
            isPulling.current = true;
        }
    }, []);

    const handleTouchMove = useCallback((e: React.TouchEvent) => {
        if (!isPulling.current) return;
        const diff = e.touches[0].clientY - pullStartY.current;
        if (diff > 0) {
            // Dampen the pull distance
            setPullOffset(Math.min(diff * 0.4, 80));
        }
    }, []);

    const handleTouchEnd = useCallback(async () => {
        if (!isPulling.current) return;
        isPulling.current = false;

        if (pullOffset >= PULL_THRESHOLD) {
            await refreshCurrentView();
        }
        setPullOffset(0);
    }, [pullOffset, refreshCurrentView]);

    // Scroll-based refresh (desktop: scroll overscroll at top)
    const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const handleScroll = useCallback(
        (e: React.UIEvent<HTMLDivElement>) => {
            const target = e.currentTarget;
            if (target.scrollTop === 0 && !isRefreshing) {
                if (!scrollTimeoutRef.current) {
                    scrollTimeoutRef.current = setTimeout(async () => {
                        await refreshCurrentView();
                        scrollTimeoutRef.current = null;
                    }, 500);
                }
            } else {
                if (scrollTimeoutRef.current) {
                    clearTimeout(scrollTimeoutRef.current);
                    scrollTimeoutRef.current = null;
                }
            }
        },
        [isRefreshing, refreshCurrentView],
    );

    // Cleanup timeout on unmount
    useEffect(() => {
        return () => {
            if (scrollTimeoutRef.current) {
                clearTimeout(scrollTimeoutRef.current);
            }
        };
    }, []);

    const handleCreateFromWorld = async (worldId: string) => {
        const instance = await createInstance({ worldId });
        if (instance) {
            onJoinInstance(instance.id, worldId);
        } else {
            alert('インスタンスの作成に失敗しました。もう一度お試しください。');
        }
    };

    const handleJoinInstance = (instanceId: string) => {
        const instance = instances.find((i) => i.id === instanceId);
        if (instance) {
            onJoinInstance(instanceId, instance.world.id);
        }
    };

    return (
        <div
            className={css({
                maxWidth: '800px',
                margin: '0 auto',
                padding: '24px 24px 0',
                display: 'flex',
                flexDirection: 'column',
                height: 'calc(100vh - 80px)',
                overflow: 'hidden',
            })}
        >
            {/* Fixed Header */}
            <div
                className={css({
                    textAlign: 'center',
                    marginBottom: '24px',
                    flexShrink: 0,
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
                    {userName}
                </h1>
                <p
                    className={css({
                        fontSize: '16px',
                        color: '#868e96',
                    })}
                >
                    インスタンスに参加するか、新しいワールドを作成しましょう
                </p>
            </div>

            {/* Fixed Tab Navigation */}
            <div
                className={css({
                    display: 'flex',
                    gap: '8px',
                    marginBottom: '16px',
                    padding: '4px',
                    backgroundColor: '#f1f3f5',
                    borderRadius: '10px',
                    flexShrink: 0,
                })}
            >
                <button
                    type="button"
                    onClick={() => handleTabSwitch('instances')}
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
                    参加可能なインスタンス ({instances.length})
                </button>
                <button
                    type="button"
                    onClick={() => handleTabSwitch('worlds')}
                    className={css({
                        flex: 1,
                        padding: '12px 16px',
                        backgroundColor: view === 'worlds' ? 'white' : 'transparent',
                        color: view === 'worlds' ? '#212529' : '#868e96',
                        border: 'none',
                        borderRadius: '8px',
                        fontSize: '14px',
                        fontWeight: '500',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                        boxShadow: view === 'worlds' ? '0 2px 4px rgba(0,0,0,0.05)' : 'none',
                    })}
                >
                    新規作成 ({worlds.length})
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
                        marginBottom: '12px',
                        fontSize: '14px',
                        flexShrink: 0,
                    })}
                >
                    {error}
                </div>
            )}

            {/* Pull-to-refresh indicator */}
            <div
                className={css({
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    overflow: 'hidden',
                    flexShrink: 0,
                    transition: 'height 0.2s ease',
                })}
                style={{ height: isRefreshing ? 40 : pullOffset > 10 ? Math.min(pullOffset, 50) : 0 }}
            >
                <div
                    className={css({
                        width: '24px',
                        height: '24px',
                        border: '3px solid #e9ecef',
                        borderTopColor: '#228BE6',
                        borderRadius: '50%',
                        animation: isRefreshing ? 'spin 0.8s linear infinite' : 'none',
                    })}
                    style={{
                        transform: isRefreshing ? undefined : `rotate(${pullOffset * 3}deg)`,
                        opacity: isRefreshing || pullOffset > 10 ? 1 : 0,
                    }}
                />
            </div>

            {/* Scrollable Content Area */}
            <div
                ref={scrollRef}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                onScroll={handleScroll}
                className={css({
                    flex: 1,
                    overflowY: 'auto',
                    overflowX: 'hidden',
                    paddingBottom: '24px',
                    // Hide scrollbar on webkit
                    '&::-webkit-scrollbar': {
                        width: '6px',
                    },
                    '&::-webkit-scrollbar-track': {
                        backgroundColor: 'transparent',
                    },
                    '&::-webkit-scrollbar-thumb': {
                        backgroundColor: '#dee2e6',
                        borderRadius: '3px',
                    },
                })}
            >
                {/* Loading */}
                {loading && !isRefreshing && (
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

                {/* Instances View */}
                {view === 'instances' && !loading && (
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
                                    🌍
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
                                    onClick={() => handleTabSwitch('worlds')}
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
                            instances.map((instance) => (
                                <InstanceCard key={instance.id} instance={instance} onJoin={handleJoinInstance} />
                            ))
                        )}
                    </div>
                )}

                {/* Worlds View */}
                {view === 'worlds' && !loading && (
                    <div>
                        <p
                            className={css({
                                fontSize: '14px',
                                color: '#868e96',
                                marginBottom: '16px',
                            })}
                        >
                            テンプレートを選択して新しいワールドを作成します
                        </p>
                        <div
                            className={css({
                                display: 'grid',
                                gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
                                gap: '16px',
                            })}
                        >
                            {worlds.map((world) => (
                                <WorldCard key={world.id} world={world} onSelect={handleCreateFromWorld} />
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
