import type { WorldListItem } from '@ubichill/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { API_BASE } from '@/lib/api';
import { css } from '@/styled-system/css';
import { InstanceCard } from './InstanceCard';
import { useInstances } from './useInstances';
import { WorldCard } from './WorldCard';

type LobbyView = 'instances' | 'worlds';

interface LobbyProps {
    onJoinInstance: (instanceId: string, worldId: string) => void;
}

export function Lobby({ onJoinInstance }: LobbyProps) {
    const navigate = useNavigate();
    const { instances, worlds, loading, error, refreshInstances, refreshWorlds } = useInstances();
    const [view, setView] = useState<LobbyView>('instances');
    const [orderedWorlds, setOrderedWorlds] = useState<WorldListItem[]>([]);

    // Pull-to-refresh state
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [pullOffset, setPullOffset] = useState(0);
    const pullStartY = useRef(0);
    const isPulling = useRef(false);
    const scrollRef = useRef<HTMLDivElement>(null);

    const PULL_THRESHOLD = 60;

    // worlds が更新されたら順序を同期
    useEffect(() => {
        setOrderedWorlds(worlds);
    }, [worlds]);

    const handleMoveWorld = useCallback(
        async (index: number, direction: -1 | 1) => {
            const next = [...orderedWorlds];
            const target = index + direction;
            if (target < 0 || target >= next.length) return;
            [next[index], next[target]] = [next[target], next[index]];
            setOrderedWorlds(next);
            try {
                const res = await fetch(`${API_BASE}/api/v1/worlds/order`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ order: next.map((w) => w.id) }),
                });
                if (!res.ok) throw new Error(`${res.status}`);
            } catch {
                // 失敗したら元に戻す
                setOrderedWorlds(orderedWorlds);
            }
        },
        [orderedWorlds],
    );

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

    const [importUrl, setImportUrl] = useState('');
    const [importState, setImportState] = useState<'idle' | 'loading' | 'error'>('idle');
    const [importError, setImportError] = useState('');

    const handleImport = useCallback(async () => {
        if (!importUrl.trim()) return;
        setImportState('loading');
        setImportError('');
        try {
            const res = await fetch(`${API_BASE}/api/v1/worlds/import`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ url: importUrl.trim() }),
            });
            if (!res.ok) {
                const data = (await res.json()) as { error?: string };
                throw new Error(data.error ?? `${res.status}`);
            }
            setImportUrl('');
            setImportState('idle');
            await refreshWorlds();
        } catch (e) {
            setImportError(e instanceof Error ? e.message : '取得失敗');
            setImportState('error');
        }
    }, [importUrl, refreshWorlds]);

    const handleNavigateToWorld = (worldId: string) => {
        navigate(`/world/${worldId}`);
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
                        bg: 'surfaceAccent',
                        borderRadius: '24px',
                        px: { base: '4', md: '8' },
                        py: { base: '5', md: '6' },
                        boxShadow: 'card',
                        flex: 1,
                        display: 'flex',
                        flexDirection: 'column',
                    })}
                >
                    <h1
                        className={css({
                            fontSize: { base: '3xl', md: '4xl' },
                            fontWeight: '700',
                            color: 'text',
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
                                backgroundColor: view === 'instances' ? 'primary' : 'secondary',
                                color: view === 'instances' ? 'textOnPrimary' : 'textMuted',
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
                                backgroundColor: view === 'worlds' ? 'primary' : 'secondary',
                                color: view === 'worlds' ? 'textOnPrimary' : 'textMuted',
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
                                backgroundColor: 'errorBg',
                                color: 'errorText',
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
                                border: '3px solid',
                                borderColor: 'primarySubtle',
                                borderTopColor: 'primary',
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
                            minH: 0,
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
                                backgroundColor: 'primarySubtle',
                                borderRadius: '3px',
                            },
                        })}
                    >
                        {loading && !isRefreshing && (
                            <div
                                className={css({
                                    textAlign: 'center',
                                    padding: '40px',
                                    color: 'textMuted',
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
                                            backgroundColor: 'secondary',
                                            borderRadius: '14px',
                                        })}
                                    >
                                        <div
                                            className={css({
                                                marginBottom: '14px',
                                                display: 'flex',
                                                justifyContent: 'center',
                                            })}
                                        >
                                            <svg
                                                width="44"
                                                height="44"
                                                viewBox="0 0 24 24"
                                                fill="none"
                                                stroke="currentColor"
                                                strokeWidth="1.5"
                                                className={css({ color: 'textSubtle' })}
                                            >
                                                <circle cx="12" cy="12" r="10" />
                                                <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                                            </svg>
                                        </div>
                                        <p
                                            className={css({
                                                fontSize: '15px',
                                                color: 'textMuted',
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
                                                backgroundColor: 'primary',
                                                color: 'textOnPrimary',
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
                                        color: 'textMuted',
                                        marginBottom: '16px',
                                    })}
                                >
                                    テンプレートを選択して新しいワールドを作成します
                                </p>

                                {/* URL インポート */}
                                <div
                                    className={css({
                                        display: 'flex',
                                        gap: '8px',
                                        marginBottom: '20px',
                                    })}
                                >
                                    <input
                                        type="url"
                                        value={importUrl}
                                        onChange={(e) => {
                                            setImportUrl(e.target.value);
                                            setImportState('idle');
                                        }}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') void handleImport();
                                        }}
                                        placeholder="GitHub URL または YAML URL を入力"
                                        className={css({
                                            flex: 1,
                                            padding: '9px 12px',
                                            borderRadius: '10px',
                                            border: '1.5px solid',
                                            borderColor: importState === 'error' ? 'errorText' : 'border',
                                            backgroundColor: 'surface',
                                            color: 'text',
                                            fontSize: '13px',
                                            outline: 'none',
                                            _focus: { borderColor: 'primary' },
                                            _placeholder: { color: 'textSubtle' },
                                        })}
                                    />
                                    <button
                                        type="button"
                                        onClick={() => void handleImport()}
                                        disabled={importState === 'loading' || !importUrl.trim()}
                                        className={css({
                                            padding: '9px 16px',
                                            backgroundColor: 'primary',
                                            color: 'textOnPrimary',
                                            border: 'none',
                                            borderRadius: '10px',
                                            fontSize: '13px',
                                            fontWeight: '600',
                                            cursor: 'pointer',
                                            whiteSpace: 'nowrap',
                                            _disabled: { opacity: 0.5, cursor: 'not-allowed' },
                                        })}
                                    >
                                        {importState === 'loading' ? '取得中...' : '読み込む'}
                                    </button>
                                </div>
                                {importState === 'error' && (
                                    <p
                                        className={css({
                                            fontSize: '12px',
                                            color: 'errorText',
                                            marginBottom: '12px',
                                            marginTop: '-12px',
                                        })}
                                    >
                                        {importError}
                                    </p>
                                )}

                                <div
                                    className={css({
                                        display: 'grid',
                                        gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
                                        gap: '16px',
                                    })}
                                >
                                    {orderedWorlds.map((world, i) => (
                                        <WorldCard
                                            key={world.id}
                                            world={world}
                                            onNavigate={handleNavigateToWorld}
                                            onMoveUp={() => handleMoveWorld(i, -1)}
                                            onMoveDown={() => handleMoveWorld(i, 1)}
                                            isFirst={i === 0}
                                            isLast={i === orderedWorlds.length - 1}
                                        />
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
