import type { WorldListItem } from '@ubichill/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { HudIcon } from '@/components/hud/HudIcon';
import { useConfirm } from '@/components/ui/ConfirmProvider';
import { createInstance } from '@/lib/instancesApi';
import { SETTINGS_KEYS, useSetting } from '@/lib/settings';
import { css } from '@/styled-system/css';
import { PasswordChangeNotice } from './PasswordChangeNotice';
import { UnavailableFavorites } from './UnavailableFavorites';
import { UnsignedWorldsNotice } from './UnsignedWorldsNotice';
import { useFavorites } from './useFavorites';
import { useFavoriteWorlds } from './useFavoriteWorlds';
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

export type WorldBrowserTab = 'local' | 'global' | 'favorites';

interface WorldBrowserProps {
    /** どの一覧を出すか（切り替えはランチパッドの「ワールド」の左） */
    tab: WorldBrowserTab;
    onJoinInstance: (
        instanceId: string,
        worldId: string,
        worldData?: { thumbnail?: string; displayName?: string },
    ) => void;
    /** 現在参加中のインスタンスID */
    currentInstanceId?: string;
}

/** ワールドを探す一覧（ランチパッドの「ワールド」）。自サーバー・連合・お気に入りのどれか 1 つを並べる。 */
export function WorldBrowser({ tab, onJoinInstance, currentInstanceId }: WorldBrowserProps) {
    const navigate = useNavigate();
    const confirm = useConfirm();

    const goConfirmed = useCallback(
        async (path: string, message: string) => {
            if (await confirm(message)) navigate(path);
        },
        [confirm, navigate],
    );
    const { worlds, globalWorlds, loading, error, refreshGlobalWorlds } = useInstances();
    const { toggle: toggleFavorite } = useFavorites();
    // 選択はワールドの URL で持つ（id はサーバーをまたぐと重複し得る）
    const [selectedWorldUrl, setSelectedWorldUrl] = useState<string | null>(null);

    // ソートキーを localStorage で永続化
    const [sortKey, handleSortChange] = useSetting<SortKey>(SETTINGS_KEYS.worldSortKey, DEFAULT_SORT, isSortKey);

    // お気に入りはサーバーが URL から解決する（ローカル・グローバルの一覧に無い外部ワールドも出す）
    const favoriteWorlds = useFavoriteWorlds(tab === 'favorites');
    const activeWorlds = tab === 'local' ? worlds : tab === 'global' ? globalWorlds : favoriteWorlds.worlds;
    const sortedWorlds = useMemo(() => sortWorlds(activeWorlds, sortKey), [activeWorlds, sortKey]);

    const selectedWorld = useMemo(
        () => sortedWorlds.find((world) => world.url === selectedWorldUrl) ?? undefined,
        [sortedWorlds, selectedWorldUrl],
    );

    const handleSelectWorld = useCallback((world: WorldListItem) => {
        setSelectedWorldUrl(world.url);
    }, []);

    useEffect(() => {
        if (tab === 'global') void refreshGlobalWorlds();
    }, [tab, refreshGlobalWorlds]);

    const [importUrl, setImportUrl] = useState('');
    const [importState, setImportState] = useState<'idle' | 'loading' | 'error'>('idle');
    const [importError, setImportError] = useState('');

    // 共有 URL を貼って「入る」。外部/リモートワールドはコピーせず、その場でインスタンスを作る。
    const handleImport = useCallback(async () => {
        if (!importUrl.trim()) return;
        setImportState('loading');
        setImportError('');
        try {
            const instance = await createInstance(importUrl.trim());
            setImportUrl('');
            setImportState('idle');
            navigate(`/instance/${instance.id}`);
        } catch (e) {
            setImportError(e instanceof Error ? e.message : '入室に失敗しました');
            setImportState('error');
        }
    }, [importUrl, navigate]);

    return (
        <div className={root} onClick={(e) => e.stopPropagation()}>
            <PasswordChangeNotice />
            <UnsignedWorldsNotice />

            <div className={toolbar}>
                <div className={css({ display: 'flex', alignItems: 'center', gap: '1' })}>
                    <select
                        value={sortKey}
                        onChange={(e) => handleSortChange(e.target.value as SortKey)}
                        aria-label="並び順"
                        className={sortSelect}
                    >
                        {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
                            <option key={key} value={key}>
                                {SORT_LABELS[key]}
                            </option>
                        ))}
                    </select>
                    <button
                        type="button"
                        className={iconButton}
                        aria-label="ワールドを作る"
                        title="ワールドを作る"
                        onClick={() => void goConfirmed('/worlds/new', 'ワールド作成画面に移動しますか？')}
                    >
                        <HudIcon name="plus" size={18} />
                    </button>
                </div>
            </div>

            {tab === 'local' && (
                <div className={css({ display: 'flex', flexDirection: 'column', gap: '1.5', flexShrink: 0 })}>
                    <div className={css({ display: 'flex', gap: '2' })}>
                        <label className={urlField} data-error={importState === 'error' || undefined}>
                            <HudIcon name="link" size={16} />
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
                                placeholder="ワールドの共有 URL を貼って入る"
                                aria-label="ワールドの共有 URL"
                                className={urlInput}
                            />
                        </label>
                        <button
                            type="button"
                            onClick={() => void handleImport()}
                            disabled={importState === 'loading' || !importUrl.trim()}
                            className={primaryButton}
                        >
                            {importState === 'loading' ? '入室中...' : '入る'}
                        </button>
                    </div>
                    {importState === 'error' && (
                        <p className={css({ fontSize: '12px', color: 'errorText' })}>{importError}</p>
                    )}
                </div>
            )}

            {error && <p className={errorBox}>{error}</p>}

            <div className={scrollArea}>
                {loading ? (
                    <p className={emptyText}>読み込み中...</p>
                ) : (
                    <>
                        {tab === 'favorites' && sortedWorlds.length === 0 && (
                            <p className={emptyText}>
                                {favoriteWorlds.loading
                                    ? '読み込み中...'
                                    : (favoriteWorlds.error ?? 'お気に入りはまだありません')}
                            </p>
                        )}
                        <div className={grid}>
                            {sortedWorlds.map((world) => (
                                <WorldCard key={world.url} world={world} onSelect={handleSelectWorld} />
                            ))}
                        </div>
                        {tab === 'favorites' && favoriteWorlds.unavailable.length > 0 && (
                            <UnavailableFavorites
                                refs={favoriteWorlds.unavailable}
                                onRemove={(ref) => void toggleFavorite(ref)}
                            />
                        )}
                    </>
                )}
                {selectedWorld && (
                    <WorldDetailModal
                        worldId={selectedWorld.id}
                        onClose={() => setSelectedWorldUrl(null)}
                        onJoinInstance={onJoinInstance}
                        currentInstanceId={currentInstanceId}
                        initialWorld={selectedWorld}
                    />
                )}
            </div>
        </div>
    );
}

const root = css({ display: 'flex', flexDirection: 'column', gap: '3', h: 'full', minH: 0 });

const toolbar = css({
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: '2',
    flexShrink: 0,
});

const sortSelect = css({
    h: '34px',
    px: '2',
    fontSize: '12px',
    color: 'textMuted',
    bg: 'transparent',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    _hover: { bg: 'surfaceHover', color: 'text' },
});

const iconButton = css({
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    w: '34px',
    h: '34px',
    bg: 'transparent',
    border: 'none',
    borderRadius: '8px',
    color: 'textMuted',
    cursor: 'pointer',
    transition: 'background-color 0.16s ease, color 0.16s ease',
    _hover: { bg: 'surfaceHover', color: 'text' },
});

const urlField = css({
    flex: 1,
    minW: 0,
    display: 'flex',
    alignItems: 'center',
    gap: '2',
    px: '3',
    h: '40px',
    bg: 'surface',
    border: '1px solid',
    borderColor: 'transparent',
    borderRadius: '10px',
    color: 'textMuted',
    transition: 'border-color 0.16s ease',
    _focusWithin: { borderColor: 'primary' },
    '&[data-error]': { borderColor: 'errorText' },
});

const urlInput = css({
    flex: 1,
    minW: 0,
    h: 'full',
    bg: 'transparent',
    border: 'none',
    outline: 'none',
    fontSize: '13px',
    color: 'text',
    _placeholder: { color: 'textSubtle' },
});

const primaryButton = css({
    flexShrink: 0,
    px: '4',
    bg: 'primary',
    color: 'textOnPrimary',
    border: 'none',
    borderRadius: '10px',
    fontSize: '13px',
    fontWeight: '700',
    whiteSpace: 'nowrap',
    cursor: 'pointer',
    transition: 'background-color 0.16s ease',
    _hover: { bg: 'primaryHover' },
    _disabled: { opacity: 0.4, cursor: 'default', _hover: { bg: 'primary' } },
});

const errorBox = css({
    px: '3.5',
    py: '2.5',
    bg: 'errorBg',
    color: 'errorText',
    borderRadius: '8px',
    fontSize: '13px',
    flexShrink: 0,
});

const scrollArea = css({ flex: 1, minH: 0, overflowY: 'auto', overflowX: 'hidden', pb: '5' });

const emptyText = css({ textAlign: 'center', py: '8', color: 'textSubtle', fontSize: '13px' });

const grid = css({
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 200px), 1fr))',
    gap: '3',
});
