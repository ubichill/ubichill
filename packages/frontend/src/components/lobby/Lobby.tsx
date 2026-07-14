import type { WorldListItem } from '@ubichill/shared';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useConfirm } from '@/components/ui/ConfirmProvider';
import { API_BASE } from '@/lib/api';
import { SETTINGS_KEYS, useSetting } from '@/lib/settings';
import { css } from '@/styled-system/css';
import { useInstances } from './useInstances';
import { WorldCard } from './WorldCard';
import { WorldDetailModal } from './WorldDetailModal';

type SortKey = 'name_asc' | 'name_desc' | 'createdAt_desc' | 'createdAt_asc' | 'updatedAt_desc' | 'updatedAt_asc';

const SORT_LABELS: Record<SortKey, string> = {
    name_asc: '名前：A→Z',
    name_desc: '名前：Z→A',
    createdAt_desc: '作成日：新しい順',
    createdAt_asc: '作成日：古い順',
    updatedAt_desc: '更新日：新しい順',
    updatedAt_asc: '更新日：古い順',
};

const DEFAULT_SORT: SortKey = 'updatedAt_desc';

const isSortKey = (value: unknown): value is SortKey => typeof value === 'string' && value in SORT_LABELS;

function sortWorlds(worlds: WorldListItem[], key: SortKey): WorldListItem[] {
    return [...worlds].sort((a, b) => {
        switch (key) {
            case 'name_asc':
                return a.displayName.localeCompare(b.displayName, 'ja');
            case 'name_desc':
                return b.displayName.localeCompare(a.displayName, 'ja');
            case 'createdAt_desc':
            case 'createdAt_asc': {
                const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
                const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
                return key === 'createdAt_desc' ? tb - ta : ta - tb;
            }
            case 'updatedAt_desc':
            case 'updatedAt_asc': {
                const ta = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
                const tb = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
                return key === 'updatedAt_desc' ? tb - ta : ta - tb;
            }
            default:
                return 0;
        }
    });
}

interface LobbyProps {
    onJoinInstance: (
        instanceId: string,
        worldId: string,
        worldData?: { thumbnail?: string; displayName?: string },
    ) => void;
    /** モーダル表示モード。省略時は 'lobby' */
    mode?: 'lobby' | 'modal';
    /** モーダルモード時、現在参加中のインスタンスID */
    currentInstanceId?: string;
}

export function Lobby({ onJoinInstance, currentInstanceId }: LobbyProps) {
    const navigate = useNavigate();
    const confirm = useConfirm();

    const goConfirmed = useCallback(
        async (path: string, message: string) => {
            if (await confirm(message)) navigate(path);
        },
        [confirm, navigate],
    );
    const { worlds, loading, error, refreshWorlds } = useInstances();
    const [selectedWorldId, setSelectedWorldId] = useState<string | null>(null);

    // ソートキーを localStorage で永続化
    const [sortKey, handleSortChange] = useSetting<SortKey>(SETTINGS_KEYS.lobbySortKey, DEFAULT_SORT, isSortKey);

    const sortedWorlds = useMemo(() => sortWorlds(worlds, sortKey), [worlds, sortKey]);

    const scrollRef = useRef<HTMLDivElement>(null);

    const selectedWorld = useMemo(
        () => sortedWorlds.find((world) => world.id === selectedWorldId) ?? undefined,
        [sortedWorlds, selectedWorldId],
    );

    const handleSelectWorld = useCallback((worldId: string) => {
        setSelectedWorldId(worldId);
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
            await refreshWorlds(true);
        } catch (e) {
            setImportError(e instanceof Error ? e.message : '取得失敗');
            setImportState('error');
        }
    }, [importUrl, refreshWorlds]);

    return (
        <div
            className={css({
                width: 'full',
                maxWidth: '5xl',
                margin: '0 auto',
                padding: { base: '8px 0 0', md: '16px 0 0' },
                display: 'flex',
                flexDirection: 'column',
                height: '100%',
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
                onClick={(e) => e.stopPropagation()}
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
                    <h1
                        className={css({
                            fontSize: { base: 'lg', sm: 'xl', md: 'xl' },
                            fontWeight: '700',
                            color: 'text',
                            mb: '4',
                            flexShrink: 0,
                        })}
                    >
                        ワールド一覧
                    </h1>

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
                        ref={scrollRef}
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
                        {loading && (
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

                        {!loading && (
                            <div>
                                <p
                                    className={css({
                                        fontSize: '14px',
                                        color: 'textMuted',
                                        marginBottom: '16px',
                                    })}
                                >
                                    ワールドを選択してインスタンスを作成または参加してください
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
                                        onClick={() =>
                                            void goConfirmed('/worlds/new', 'ワールド作成画面に移動しますか？')
                                        }
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
                                </div>

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

                                {/* ワールドカードの直上にソートを配置 */}
                                <div
                                    className={css({
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'space-between',
                                        gap: '2',
                                        marginBottom: '12px',
                                    })}
                                >
                                    <span className={css({ fontSize: '13px', fontWeight: '600', color: 'text' })}>
                                        ワールド一覧
                                    </span>
                                    <select
                                        id="world-sort-select"
                                        value={sortKey}
                                        onChange={(e) => handleSortChange(e.target.value as SortKey)}
                                        aria-label="ソート条件"
                                        className={css({
                                            fontSize: '12px',
                                            color: 'textMuted',
                                            bg: 'surface',
                                            border: '1px solid',
                                            borderColor: 'border',
                                            borderRadius: '8px',
                                            px: '8px',
                                            py: '5px',
                                            cursor: 'pointer',
                                            outline: 'none',
                                            flexShrink: 0,
                                            _hover: { borderColor: 'borderStrong' },
                                            _focus: { borderColor: 'primary' },
                                        })}
                                    >
                                        {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
                                            <option key={key} value={key}>
                                                {SORT_LABELS[key]}
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                <div
                                    className={css({
                                        display: 'grid',
                                        gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
                                        gap: '16px',
                                    })}
                                >
                                    {sortedWorlds.map((world) => (
                                        <WorldCard
                                            key={world.id}
                                            world={world}
                                            onNavigate={(worldId) => handleSelectWorld(worldId)}
                                        />
                                    ))}
                                </div>
                            </div>
                        )}
                        {selectedWorldId && selectedWorld && (
                            <WorldDetailModal
                                worldId={selectedWorldId}
                                onClose={() => setSelectedWorldId(null)}
                                onJoinInstance={onJoinInstance}
                                currentInstanceId={currentInstanceId}
                                initialWorld={selectedWorld}
                            />
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
