/**
 * video-player:search Worker — URL 追加 + YouTube 検索 UI。
 *
 * watchScope='parent' で screen.playlist を読み書きする。
 * 検索クエリ / 結果 / 入力中フラグはローカル状態。
 */

import type { RpcNetFetchResult } from '@ubichill/sdk';
import { SearchIcon, VideoIcon } from './icons';
import type { SearchResult, Track } from './types';

const DEFAULT_API_BASE = '/plugins/video-player/api';

const state = Ubi.state.define({
    playlist: Ubi.state.persistent([] as Track[]),
    apiBase: Ubi.state.persistent(DEFAULT_API_BASE),
    // ローカル
    selectedMode: 'video' as 'live' | 'video',
    urlInput: '',
    searchQuery: '',
    searchResults: [] as SearchResult[],
    isSearching: false,
});

const fmt = (sec: number): string => {
    if (!Number.isFinite(sec) || sec <= 0) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
};

const apiBase = (): string => state.local.apiBase.trim() || DEFAULT_API_BASE;

const extractYouTubeId = (url: string): string | null => {
    const patterns = [
        /(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/,
        /youtube\.com\/embed\/([\w-]+)/,
        /^([\w-]{11})$/,
    ];
    for (const p of patterns) {
        const m = url.match(p);
        if (m) return m[1];
    }
    return null;
};

// ── アクション ──────────────────────────────────────
const setMode = (m: 'live' | 'video'): void => {
    state.local.selectedMode = m;
    render();
};

const setUrl = (v: string): void => {
    state.local.urlInput = v;
};

const setQuery = (v: string): void => {
    state.local.searchQuery = v;
};

const addFromUrl = async (): Promise<void> => {
    const videoId = extractYouTubeId(state.local.urlInput.trim());
    if (!videoId) return;
    state.local.isSearching = true;
    render();
    const res = (await Ubi.fetch(`${apiBase()}/info/${videoId}`)) as RpcNetFetchResult;
    const info = res.ok ? (JSON.parse(res.body) as { title?: string; thumbnail?: string; duration?: number }) : {};
    state.local.playlist = [
        ...state.local.playlist,
        {
            id: videoId,
            title: info.title ?? state.local.urlInput,
            thumbnail: info.thumbnail ?? `https://i.ytimg.com/vi/${videoId}/default.jpg`,
            duration: info.duration ?? 0,
            mode: state.local.selectedMode,
        },
    ];
    state.local.urlInput = '';
    state.local.isSearching = false;
    render();
};

const doSearch = async (): Promise<void> => {
    if (!state.local.searchQuery.trim()) return;
    state.local.isSearching = true;
    render();
    const res = (await Ubi.fetch(
        `${apiBase()}/search?q=${encodeURIComponent(state.local.searchQuery)}&limit=10`,
    )) as RpcNetFetchResult;
    state.local.searchResults = res.ok ? (JSON.parse(res.body) as SearchResult[]) : [];
    state.local.isSearching = false;
    render();
};

const addResult = (r: SearchResult): void => {
    state.local.playlist = [
        ...state.local.playlist,
        {
            id: r.id,
            title: r.title,
            thumbnail: r.thumbnail,
            duration: r.duration,
            mode: state.local.selectedMode,
        },
    ];
    state.local.searchResults = [];
    state.local.searchQuery = '';
    render();
};

// ── レンダリング ───────────────────────────────────
function render(): void {
    const { selectedMode, urlInput, searchQuery, searchResults, isSearching } = state.local;

    Ubi.ui.render(
        () => (
            <div
                style={{
                    position: 'absolute',
                    inset: '0',
                    background: '#1a1a1a',
                    borderRadius: '12px',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    overflow: 'hidden',
                    display: 'flex',
                    flexDirection: 'column',
                    fontFamily: 'system-ui, -apple-system, sans-serif',
                    userSelect: 'none',
                    pointerEvents: 'auto',
                }}
            >
                <div style={{ padding: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {/* モード選択 */}
                    <div style={{ display: 'flex', gap: '0' }}>
                        <button
                            type="button"
                            style={{
                                flex: '1',
                                background: selectedMode === 'live' ? '#ff4444' : '#333',
                                border: 'none',
                                borderRadius: '4px 0 0 4px',
                                color: '#fff',
                                padding: '6px 12px',
                                fontSize: '12px',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '6px',
                            }}
                            onUbiClick={() => setMode('live')}
                        >
                            <span
                                style={{
                                    width: '7px',
                                    height: '7px',
                                    borderRadius: '50%',
                                    background: '#fff',
                                    display: 'inline-block',
                                }}
                            />
                            Live
                        </button>
                        <button
                            type="button"
                            style={{
                                flex: '1',
                                background: selectedMode === 'video' ? '#4444ff' : '#333',
                                border: 'none',
                                borderRadius: '0 4px 4px 0',
                                color: '#fff',
                                padding: '6px 12px',
                                fontSize: '12px',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '6px',
                            }}
                            onUbiClick={() => setMode('video')}
                        >
                            <VideoIcon size={12} />
                            Video
                        </button>
                    </div>

                    {/* URL 入力 */}
                    <div style={{ display: 'flex', gap: '4px' }}>
                        <input
                            type="text"
                            placeholder="YouTube URL or ID..."
                            value={urlInput}
                            style={{
                                flex: '1',
                                background: 'rgba(255,255,255,0.1)',
                                border: '1px solid rgba(255,255,255,0.2)',
                                borderRadius: '6px',
                                padding: '5px 8px',
                                color: '#fff',
                                fontSize: '12px',
                                outline: 'none',
                                minWidth: '0',
                            }}
                            onUbiInput={(val: unknown) => setUrl(String(val))}
                        />
                        <button
                            type="button"
                            disabled={isSearching}
                            style={{
                                background: 'rgba(255,255,255,0.1)',
                                border: 'none',
                                color: 'rgba(255,255,255,0.8)',
                                cursor: isSearching ? 'not-allowed' : 'pointer',
                                padding: '5px 10px',
                                borderRadius: '6px',
                                fontSize: '14px',
                                opacity: isSearching ? '0.5' : '1',
                            }}
                            onUbiClick={() => {
                                void addFromUrl();
                            }}
                        >
                            +
                        </button>
                    </div>

                    {/* 検索クエリ */}
                    <div style={{ display: 'flex', gap: '4px' }}>
                        <input
                            type="text"
                            placeholder="Search YouTube..."
                            value={searchQuery}
                            style={{
                                flex: '1',
                                background: 'rgba(255,255,255,0.1)',
                                border: '1px solid rgba(255,255,255,0.2)',
                                borderRadius: '6px',
                                padding: '5px 8px',
                                color: '#fff',
                                fontSize: '12px',
                                outline: 'none',
                                minWidth: '0',
                            }}
                            onUbiInput={(val: unknown) => setQuery(String(val))}
                        />
                        <button
                            type="button"
                            disabled={isSearching}
                            style={{
                                background: 'rgba(255,255,255,0.1)',
                                border: 'none',
                                color: 'rgba(255,255,255,0.8)',
                                cursor: isSearching ? 'not-allowed' : 'pointer',
                                padding: '5px 10px',
                                borderRadius: '6px',
                                display: 'flex',
                                alignItems: 'center',
                                opacity: isSearching ? '0.5' : '1',
                            }}
                            onUbiClick={() => {
                                void doSearch();
                            }}
                        >
                            <SearchIcon size={14} />
                        </button>
                    </div>
                </div>

                {/* 検索結果 */}
                <div style={{ flex: '1', overflowY: 'auto', padding: '8px' }}>
                    {searchResults.length === 0 ? (
                        <div
                            style={{
                                padding: '24px',
                                textAlign: 'center',
                                fontSize: '12px',
                                color: 'rgba(255,255,255,0.5)',
                            }}
                        >
                            {isSearching ? 'Searching...' : 'No results'}
                        </div>
                    ) : (
                        searchResults.map((r) => (
                            <div
                                key={r.id}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                    padding: '6px 8px',
                                    borderRadius: '6px',
                                    marginBottom: '4px',
                                }}
                            >
                                <img
                                    src={r.thumbnail}
                                    alt=""
                                    style={{
                                        width: '32px',
                                        height: '32px',
                                        borderRadius: '4px',
                                        objectFit: 'cover',
                                    }}
                                />
                                <div style={{ flex: '1', minWidth: '0' }}>
                                    <div
                                        style={{
                                            fontSize: '11px',
                                            fontWeight: '500',
                                            color: '#fff',
                                            whiteSpace: 'nowrap',
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                        }}
                                    >
                                        {r.title}
                                    </div>
                                    <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.6)' }}>
                                        {fmt(r.duration)}
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    style={{
                                        background: 'transparent',
                                        border: 'none',
                                        color: 'rgba(255,255,255,0.6)',
                                        cursor: 'pointer',
                                        padding: '4px 8px',
                                        borderRadius: '4px',
                                        fontSize: '16px',
                                    }}
                                    onUbiClick={() => addResult(r)}
                                >
                                    +
                                </button>
                            </div>
                        ))
                    )}
                </div>
            </div>
        ),
        'search',
    );
}

render();
