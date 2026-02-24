'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useInstances } from '@/core/hooks/useInstances';
import { css } from '@/styled-system/css';
import { InstanceCard } from './InstanceCard';
import { WorldCard } from './WorldCard';

type LobbyView = 'instances' | 'worlds';

interface LobbyProps {
    onJoinInstance: (instanceId: string, worldId: string) => void;
}

export function Lobby({ onJoinInstance }: LobbyProps) {
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
                width: 'full',
                maxWidth: '5xl',
                margin: '0 auto',
                padding: { base: '8px 0 0', md: '16px 0 0' },
                display: 'flex',
                flexDirection: 'column',
                height: 'calc(100vh - 112px)',
                overflow: 'hidden',
            })}
        >
            <div
                className={css({
                    width: 'full',
                    maxW: '730px',
                    mx: 'auto',
                    mb: '4',
                    px: { base: '2', md: '0' },
                })}
            >
                <div
                    className={css({
                        bg: '#162542',
                        borderRadius: '24px',
                        px: { base: '4', md: '8' },
                        py: { base: '5', md: '6' },
                        boxShadow: '0 20px 38px rgba(3, 8, 18, 0.4)',
                        minH: '650px',
                        display: 'flex',
                        flexDirection: 'column',
                    })}
                >
                    <h1
                        className={css({
                            fontSize: { base: '3xl', md: '4xl' },
                            fontWeight: '700',
                            color: '#f2e6d6',
                            mb: '4',
                        })}
                    >
                        ワールド選択
                    </h1>

                    <div
                        className={css({
                            display: 'flex',
                            gap: '3',
                            mb: '4',
                            flexShrink: 0,
                        })}
                    >
                        <button
                            type="button"
                            onClick={() => handleTabSwitch('instances')}
                            className={css({
                                flex: 1,
                                padding: '10px 14px',
                                backgroundColor: view === 'instances' ? '#e6d8c5' : '#29406d',
                                color: view === 'instances' ? '#1b2a44' : '#d7e1f5',
                                border: 'none',
                                borderRadius: '10px',
                                fontSize: { base: 'xs', sm: 'sm' },
                                fontWeight: '600',
                                cursor: 'pointer',
                                transition: 'opacity 0.16s ease',
                                whiteSpace: 'nowrap',
                                _hover: { opacity: 0.9 },
                            })}
                        >
                            参加可能なインスタンス
                        </button>
                        <button
                            type="button"
                            onClick={() => handleTabSwitch('worlds')}
                            className={css({
                                flex: 1,
                                padding: '10px 14px',
                                backgroundColor: view === 'worlds' ? '#e6d8c5' : '#29406d',
                                color: view === 'worlds' ? '#1b2a44' : '#d7e1f5',
                                border: 'none',
                                borderRadius: '10px',
                                fontSize: { base: 'xs', sm: 'sm' },
                                fontWeight: '600',
                                cursor: 'pointer',
                                transition: 'opacity 0.16s ease',
                                _hover: { opacity: 0.9 },
                            })}
                        >
                            新規作成
                        </button>
                    </div>

                    {error && (
                        <div
                            className={css({
                                padding: '10px 14px',
                                backgroundColor: '#472a37',
                                color: '#ffdce5',
                                borderRadius: '8px',
                                marginBottom: '12px',
                                fontSize: '13px',
                                flexShrink: 0,
                            })}
                        >
                            {error}
                        </div>
                    )}

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
                                border: '3px solid rgba(230, 216, 197, 0.35)',
                                borderTopColor: '#e6d8c5',
                                borderRadius: '50%',
                                animation: isRefreshing ? 'spin 0.8s linear infinite' : 'none',
                            })}
                            style={{
                                transform: isRefreshing ? undefined : `rotate(${pullOffset * 3}deg)`,
                                opacity: isRefreshing || pullOffset > 10 ? 1 : 0,
                            }}
                        />
                    </div>

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
                            paddingBottom: '20px',
                            '&::-webkit-scrollbar': {
                                width: '6px',
                            },
                            '&::-webkit-scrollbar-track': {
                                backgroundColor: 'transparent',
                            },
                            '&::-webkit-scrollbar-thumb': {
                                backgroundColor: 'rgba(230, 216, 197, 0.3)',
                                borderRadius: '3px',
                            },
                        })}
                    >
                        {loading && !isRefreshing && (
                            <div
                                className={css({
                                    textAlign: 'center',
                                    padding: '40px',
                                    color: '#d5ccb9',
                                })}
                            >
                                読み込み中...
                            </div>
                        )}

                        {view === 'instances' && !loading && (
                            <div className={css({ display: 'flex', flexDirection: 'column', gap: '3' })}>
                                {instances.length === 0 ? (
                                    <div
                                        className={css({
                                            textAlign: 'center',
                                            padding: '56px 24px',
                                            backgroundColor: '#1e3258',
                                            borderRadius: '14px',
                                        })}
                                    >
                                        <p
                                            className={css({
                                                fontSize: '44px',
                                                marginBottom: '14px',
                                            })}
                                        >
                                            🌍
                                        </p>
                                        <p
                                            className={css({
                                                fontSize: '15px',
                                                color: '#d8cfbf',
                                                marginBottom: '16px',
                                            })}
                                        >
                                            参加可能なインスタンスがありません
                                        </p>
                                        <button
                                            type="button"
                                            onClick={() => handleTabSwitch('worlds')}
                                            className={css({
                                                padding: '10px 20px',
                                                backgroundColor: '#e6d8c5',
                                                color: '#1b2a44',
                                                border: 'none',
                                                borderRadius: '10px',
                                                fontSize: '14px',
                                                fontWeight: '600',
                                                cursor: 'pointer',
                                            })}
                                        >
                                            新規作成
                                        </button>
                                    </div>
                                ) : (
                                    instances.map((instance) => (
                                        <InstanceCard
                                            key={instance.id}
                                            instance={instance}
                                            onJoin={handleJoinInstance}
                                        />
                                    ))
                                )}
                            </div>
                        )}

                        {view === 'worlds' && !loading && (
                            <div>
                                <p
                                    className={css({
                                        fontSize: '14px',
                                        color: '#d8cfbf',
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
            </div>
        </div>
    );
}
