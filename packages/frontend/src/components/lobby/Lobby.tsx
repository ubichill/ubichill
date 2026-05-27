import type { WorldListItem } from '@ubichill/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { API_BASE } from '@/lib/api';
import { css } from '@/styled-system/css';
import { InstanceCard } from './InstanceCard';
import { useInstances } from './useInstances';
import { WorldCard } from './WorldCard';

interface LobbyProps {
    onJoinInstance: (instanceId: string, worldId: string) => void;
}

export function Lobby({ onJoinInstance }: LobbyProps) {
    const navigate = useNavigate();
    const { instances, worlds, loading, error, createInstance, refreshInstances, refreshWorlds } = useInstances();
    const [selectedWorldId, setSelectedWorldId] = useState<string | null>(null);
    const [orderedWorlds, setOrderedWorlds] = useState<WorldListItem[]>([]);
    const [creating, setCreating] = useState(false);

    const [isRefreshing, setIsRefreshing] = useState(false);
    const [pullOffset, setPullOffset] = useState(0);
    const pullStartY = useRef(0);
    const isPulling = useRef(false);
    const scrollRef = useRef<HTMLDivElement>(null);

    const PULL_THRESHOLD = 60;

    const selectedWorld = useMemo(
        () => orderedWorlds.find((world) => world.id === selectedWorldId) ?? null,
        [orderedWorlds, selectedWorldId],
    );

    useEffect(() => {
        setOrderedWorlds(worlds);
    }, [worlds]);

    const refreshCurrentView = useCallback(async () => {
        setIsRefreshing(true);
        try {
            if (selectedWorldId) {
                await refreshInstances(selectedWorldId);
            } else {
                await refreshWorlds();
            }
        } finally {
            setIsRefreshing(false);
        }
    }, [selectedWorldId, refreshInstances, refreshWorlds]);

    const handleSelectWorld = useCallback(
        async (worldId: string) => {
            setSelectedWorldId(worldId);
            scrollRef.current?.scrollTo({ top: 0 });
            await refreshInstances(worldId);
        },
        [refreshInstances],
    );

    const handleBackToWorlds = useCallback(() => {
        setSelectedWorldId(null);
        scrollRef.current?.scrollTo({ top: 0 });
    }, []);

    const handleCreateInstance = useCallback(async () => {
        if (!selectedWorldId || creating) return;
        setCreating(true);
        try {
            const instance = await createInstance({ worldId: selectedWorldId });
            if (instance) {
                onJoinInstance(instance.id, instance.world.id);
            }
        } finally {
            setCreating(false);
        }
    }, [selectedWorldId, creating, createInstance, onJoinInstance]);

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
                setOrderedWorlds(orderedWorlds);
            }
        },
        [orderedWorlds],
    );

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
            } else if (scrollTimeoutRef.current) {
                clearTimeout(scrollTimeoutRef.current);
                scrollTimeoutRef.current = null;
            }
        },
        [isRefreshing, refreshCurrentView],
    );

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
                    display: 'flex',
                    flexDirection: 'column',
                    flex: 1,
                    minH: 0,
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
                        minH: 0,
                    })}
                >
                    <div className={css({ display: 'flex', alignItems: 'center', gap: '3', mb: '4' })}>
                        {selectedWorld && (
                            <button
                                type="button"
                                onClick={handleBackToWorlds}
                                aria-label="テンプレート一覧へ戻る"
                                className={css({
                                    width: '36px',
                                    height: '36px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    bg: 'secondary',
                                    color: 'text',
                                    border: 'none',
                                    borderRadius: '10px',
                                    cursor: 'pointer',
                                    flexShrink: 0,
                                    _hover: { opacity: 0.9 },
                                })}
                            >
                                <svg
                                    width="18"
                                    height="18"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                >
                                    <path d="M19 12H5" />
                                    <path d="m12 19-7-7 7-7" />
                                </svg>
                            </button>
                        )}
                        <h1
                            className={css({
                                fontSize: { base: '3xl', md: '4xl' },
                                fontWeight: '700',
                                color: 'text',
                                minW: 0,
                            })}
                        >
                            {selectedWorld ? selectedWorld.displayName : 'ワールド選択'}
                        </h1>
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
                            <div className={css({ textAlign: 'center', padding: '40px', color: 'textMuted' })}>
                                読み込み中...
                            </div>
                        )}

                        {!selectedWorld && !loading && (
                            <div>
                                <p className={css({ fontSize: '14px', color: 'textMuted', marginBottom: '16px' })}>
                                    テンプレートを選択すると、そのワールドで作られたインスタンスを表示します
                                </p>

                                <div
                                    className={css({
                                        display: 'flex',
                                        gap: '8px',
                                        marginBottom: '16px',
                                        flexWrap: 'wrap',
                                    })}
                                >
                                    <button
                                        type="button"
                                        onClick={() => navigate('/worlds/new')}
                                        className={css({
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            gap: '6px',
                                            padding: '9px 16px',
                                            backgroundColor: 'primary',
                                            color: 'textOnPrimary',
                                            border: 'none',
                                            borderRadius: '10px',
                                            fontSize: '13px',
                                            fontWeight: '600',
                                            cursor: 'pointer',
                                            _hover: { opacity: 0.9 },
                                        })}
                                    >
                                        <svg
                                            width="14"
                                            height="14"
                                            viewBox="0 0 24 24"
                                            fill="none"
                                            stroke="currentColor"
                                            strokeWidth="2"
                                        >
                                            <path d="M12 5v14M5 12h14" />
                                        </svg>
                                        自分でワールドを作る
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => navigate('/user/me')}
                                        className={css({
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            gap: '6px',
                                            padding: '9px 16px',
                                            backgroundColor: 'secondary',
                                            color: 'text',
                                            border: 'none',
                                            borderRadius: '10px',
                                            fontSize: '13px',
                                            fontWeight: '600',
                                            cursor: 'pointer',
                                            _hover: { opacity: 0.9 },
                                        })}
                                    >
                                        <svg
                                            width="14"
                                            height="14"
                                            viewBox="0 0 24 24"
                                            fill="none"
                                            stroke="currentColor"
                                            strokeWidth="2"
                                        >
                                            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                                            <circle cx="12" cy="7" r="4" />
                                        </svg>
                                        マイページ
                                    </button>
                                </div>

                                <div className={css({ display: 'flex', gap: '8px', marginBottom: '20px' })}>
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
                                            minW: 0,
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
                                            onNavigate={(worldId) => void handleSelectWorld(worldId)}
                                            onMoveUp={() => handleMoveWorld(i, -1)}
                                            onMoveDown={() => handleMoveWorld(i, 1)}
                                            isFirst={i === 0}
                                            isLast={i === orderedWorlds.length - 1}
                                        />
                                    ))}
                                </div>
                            </div>
                        )}

                        {selectedWorld && !loading && (
                            <div className={css({ display: 'flex', flexDirection: 'column', gap: '4' })}>
                                <div
                                    className={css({
                                        display: 'grid',
                                        gridTemplateColumns: { base: '1fr', sm: '160px 1fr' },
                                        gap: '4',
                                        alignItems: 'stretch',
                                        p: '4',
                                        bg: 'surface',
                                        border: '1px solid',
                                        borderColor: 'border',
                                        borderRadius: '14px',
                                    })}
                                >
                                    <div
                                        className={css({
                                            minH: '104px',
                                            borderRadius: '10px',
                                            overflow: 'hidden',
                                            bg: 'secondary',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                        })}
                                    >
                                        {selectedWorld.thumbnail ? (
                                            <img
                                                src={selectedWorld.thumbnail}
                                                alt={selectedWorld.displayName}
                                                className={css({ width: '100%', height: '100%', objectFit: 'cover' })}
                                            />
                                        ) : (
                                            <svg
                                                width="36"
                                                height="36"
                                                viewBox="0 0 24 24"
                                                fill="none"
                                                stroke="currentColor"
                                                strokeWidth="1.5"
                                                className={css({ color: 'textSubtle' })}
                                            >
                                                <circle cx="12" cy="12" r="10" />
                                                <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                                            </svg>
                                        )}
                                    </div>
                                    <div className={css({ minW: 0 })}>
                                        {selectedWorld.description && (
                                            <p
                                                className={css({
                                                    fontSize: '14px',
                                                    color: 'textMuted',
                                                    lineHeight: '1.5',
                                                    marginBottom: '10px',
                                                })}
                                            >
                                                {selectedWorld.description}
                                            </p>
                                        )}
                                        <div
                                            className={css({
                                                display: 'flex',
                                                gap: '2',
                                                flexWrap: 'wrap',
                                                fontSize: '12px',
                                                color: 'textSubtle',
                                                marginBottom: '14px',
                                            })}
                                        >
                                            <span>
                                                {selectedWorld.capacity.default}〜{selectedWorld.capacity.max}人
                                            </span>
                                            <span>v{selectedWorld.version}</span>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => void handleCreateInstance()}
                                            disabled={creating}
                                            className={css({
                                                padding: '10px 16px',
                                                backgroundColor: 'primary',
                                                color: 'textOnPrimary',
                                                border: 'none',
                                                borderRadius: '10px',
                                                fontSize: '14px',
                                                fontWeight: '600',
                                                cursor: 'pointer',
                                                _hover: { opacity: 0.9 },
                                                _disabled: { opacity: 0.6, cursor: 'not-allowed' },
                                            })}
                                        >
                                            {creating ? '作成中...' : '新しいインスタンスを作成'}
                                        </button>
                                    </div>
                                </div>

                                {instances.length === 0 ? (
                                    <div
                                        className={css({
                                            textAlign: 'center',
                                            padding: '40px 20px',
                                            backgroundColor: 'secondary',
                                            borderRadius: '14px',
                                        })}
                                    >
                                        <p
                                            className={css({
                                                fontSize: '15px',
                                                color: 'textMuted',
                                                marginBottom: '16px',
                                            })}
                                        >
                                            このテンプレートの参加可能なインスタンスはありません
                                        </p>
                                        <button
                                            type="button"
                                            onClick={() => void handleCreateInstance()}
                                            disabled={creating}
                                            className={css({
                                                padding: '10px 18px',
                                                backgroundColor: 'primary',
                                                color: 'textOnPrimary',
                                                border: 'none',
                                                borderRadius: '10px',
                                                fontSize: '14px',
                                                fontWeight: '600',
                                                cursor: 'pointer',
                                                _disabled: { opacity: 0.6, cursor: 'not-allowed' },
                                            })}
                                        >
                                            {creating ? '作成中...' : '新しく作成して参加'}
                                        </button>
                                    </div>
                                ) : (
                                    <div className={css({ display: 'flex', flexDirection: 'column', gap: '3' })}>
                                        {instances.map((instance) => (
                                            <InstanceCard
                                                key={instance.id}
                                                instance={instance}
                                                onJoin={handleJoinInstance}
                                            />
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
