/**
 * video-player:controls System レイヤー。
 *
 * 共有状態は Ubi.state.persistent / persistMine で宣言するだけで
 * watchEntityTypes=['video-player:screen'] に自動的に bound される。
 * entity.data の読み書きは SDK が代行するので、このファイルは純粋な UI ロジックに集中できる。
 */

import type { Entity, RpcNetFetchResult, System, WorkerEvent } from '@ubichill/sdk';
import type { LoopMode, SearchResult, Track } from '../types';
import type { ControlsUIActions, ControlsUIState } from '../ui/controls.ui';
import { renderControlsUI } from '../ui/controls.ui';

const state = Ubi.state.define({
    // entity.data と自動同期される共有状態
    playlist: Ubi.state.persistent([] as Track[]),
    currentIndex: Ubi.state.persistent(0),
    isPlaying: Ubi.state.persistent(false),
    isVisible: Ubi.state.persistent(false),
    loop: Ubi.state.persistent<LoopMode>('none'),
    shuffle: Ubi.state.persistent(false),
    currentTime: Ubi.state.persistent(0),
    duration: Ubi.state.persistent(0),
    apiBase: Ubi.state.persistent(''),
    seekNonce: Ubi.state.persistent(0),
    // per-user 音量
    myVolume: Ubi.state.persistMine(0.7),
    // 進行バー推定用 (ローカル)
    lastSyncedTime: 0,
    lastSyncedAt: 0,
    // サイズ (transform は state では管理しない)
    screenW: 640,
    screenH: 360,
    screenEntityId: null as string | null,
    screenTransform: null as {
        x: number;
        y: number;
        z: number;
        w: number;
        h: number;
        scale: number;
        rotation: number;
    } | null,
    // UI ローカル
    showPlaylist: true,
    selectedMode: 'video' as 'live' | 'video',
    urlInput: '',
    searchQuery: '',
    searchResults: [] as SearchResult[],
    isSearching: false,
});

const SIZE_PRESETS: [number, number][] = [
    [640, 360],
    [960, 540],
    [1280, 720],
];

const DEFAULT_API_BASE = '/plugins/video-player/api';

// ── ヘルパー ─────────────────────────────────────────

const _fmt = (sec: number): string => {
    if (!Number.isFinite(sec) || sec <= 0) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
};

const _extractYouTubeId = (url: string): string | null => {
    const patterns = [
        /(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/,
        /youtube\.com\/embed\/([\w-]+)/,
        /^([\w-]{11})$/,
    ];
    for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match) return match[1];
    }
    return null;
};

function _estimatedTime(): number {
    if (!state.local.isPlaying || state.local.duration <= 0) return state.local.lastSyncedTime;
    const elapsed = (Date.now() - state.local.lastSyncedAt) / 1000;
    return Math.min(state.local.lastSyncedTime + elapsed, state.local.duration);
}

function _apiBase(): string {
    return state.local.apiBase.trim() || DEFAULT_API_BASE;
}

// ── 共有状態の変化で「時計の起点」を合わせる ───────────

state.onChange('currentTime', (next) => {
    state.local.lastSyncedTime = next;
    state.local.lastSyncedAt = Date.now();
});

state.onChange('isPlaying', (playing) => {
    if (playing) {
        state.local.lastSyncedAt = Date.now();
    } else {
        state.local.lastSyncedTime = _estimatedTime();
    }
    _render();
});

state.onChange('currentIndex', () => {
    state.local.lastSyncedTime = 0;
    state.local.lastSyncedAt = Date.now();
    state.local.duration = 0;
    _render();
});

state.onChange('seekNonce', () => {
    state.local.lastSyncedTime = state.local.currentTime;
    state.local.lastSyncedAt = Date.now();
    _render();
});

state.onChange('playlist', (v) => {
    Ubi.log(`[Controls:onChange] playlist changed: ${(v as unknown[]).length} tracks`, 'info');
    _render();
});
state.onChange('isVisible', _render);
state.onChange('loop', _render);
state.onChange('shuffle', _render);
state.onChange('duration', _render);
state.onChange('myVolume', _render);

// ── Actions (UI から呼ばれる純粋な副作用関数) ─────────────

const actions: ControlsUIActions = {
    onSeek: (time) => {
        state.local.currentTime = time;
        state.local.seekNonce = Date.now();
    },
    onPlayToggle: () => {
        const next = !state.local.isPlaying;
        state.local.currentTime = next ? state.local.lastSyncedTime : _estimatedTime();
        state.local.isPlaying = next;
    },
    onPrev: () => {
        if (state.local.playlist.length === 0) return;
        const prev = state.local.currentIndex > 0 ? state.local.currentIndex - 1 : state.local.playlist.length - 1;
        state.local.currentTime = 0;
        state.local.currentIndex = prev;
        state.local.isPlaying = true;
    },
    onNext: () => {
        if (state.local.playlist.length === 0) return;
        const next = state.local.currentIndex < state.local.playlist.length - 1 ? state.local.currentIndex + 1 : 0;
        state.local.currentTime = 0;
        state.local.currentIndex = next;
        state.local.isPlaying = true;
    },
    onShuffleToggle: () => {
        state.local.shuffle = !state.local.shuffle;
    },
    onLoopCycle: () => {
        state.local.loop =
            state.local.loop === 'none' ? 'playlist' : state.local.loop === 'playlist' ? 'track' : 'none';
    },
    onVolumeChange: (v) => {
        state.local.myVolume = v;
    },
    onVisibilityToggle: () => {
        state.local.isVisible = !state.local.isVisible;
    },
    onResize: () => {
        if (!state.local.screenEntityId || !state.local.screenTransform) return;
        const current = SIZE_PRESETS.findIndex(([w]) => w === state.local.screenW);
        const [nw, nh] = SIZE_PRESETS[(current + 1) % SIZE_PRESETS.length];
        state.local.screenW = nw;
        state.local.screenH = nh;
        const nextTransform = { ...state.local.screenTransform, w: nw, h: nh };
        void Ubi.world.updateEntity(state.local.screenEntityId, { transform: nextTransform });
        state.local.screenTransform = nextTransform;
        _render();
    },
    onShowPlaylistToggle: () => {
        state.local.showPlaylist = !state.local.showPlaylist;
        _render();
    },
    onSelectMode: (mode) => {
        state.local.selectedMode = mode;
        _render();
    },
    onUrlInputChange: (v) => {
        state.local.urlInput = v;
    },
    onAddFromUrl: () => {
        void _addFromUrl();
    },
    onSearchQueryChange: (v) => {
        state.local.searchQuery = v;
    },
    onDoSearch: () => {
        void _doSearch();
    },
    onAddSearchResult: (result) => {
        state.local.playlist = [
            ...state.local.playlist,
            {
                id: result.id,
                title: result.title,
                thumbnail: result.thumbnail,
                duration: result.duration,
                mode: state.local.selectedMode,
            },
        ];
        state.local.searchResults = [];
        state.local.searchQuery = '';
    },
    onSelectTrack: (i) => {
        state.local.currentTime = 0;
        state.local.currentIndex = i;
        state.local.isPlaying = true;
    },
    onRemoveTrack: (i) => {
        const newList = state.local.playlist.filter((_, idx) => idx !== i);
        const newIdx =
            state.local.currentIndex >= newList.length ? Math.max(0, newList.length - 1) : state.local.currentIndex;
        state.local.playlist = newList;
        state.local.currentIndex = newIdx;
    },
};

async function _addFromUrl(): Promise<void> {
    const videoId = _extractYouTubeId(state.local.urlInput.trim());
    if (!videoId) return;
    state.local.isSearching = true;
    _render();
    try {
        const res = (await Ubi.network.fetch(`${_apiBase()}/info/${videoId}`)) as RpcNetFetchResult;
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
    } catch (err) {
        Ubi.log(`[Controls] addFromUrl error: ${String(err)}`, 'warn');
    }
    state.local.isSearching = false;
    _render();
}

async function _doSearch(): Promise<void> {
    if (!state.local.searchQuery.trim()) return;
    state.local.isSearching = true;
    _render();
    try {
        const res = (await Ubi.network.fetch(
            `${_apiBase()}/search?q=${encodeURIComponent(state.local.searchQuery)}&limit=10`,
        )) as RpcNetFetchResult;
        if (res.ok) state.local.searchResults = JSON.parse(res.body) as SearchResult[];
    } catch (err) {
        Ubi.log(`[Controls] search error: ${String(err)}`, 'warn');
    }
    state.local.isSearching = false;
    _render();
}

// ── レンダリング ─────────────────────────────────────

function _toUIState(): ControlsUIState {
    return {
        playlist: state.local.playlist,
        currentIndex: state.local.currentIndex,
        isPlaying: state.local.isPlaying,
        isVisible: state.local.isVisible,
        volume: state.local.myVolume,
        loop: state.local.loop,
        shuffle: state.local.shuffle,
        duration: state.local.duration,
        currentTime: _estimatedTime(),
        showPlaylist: state.local.showPlaylist,
        selectedMode: state.local.selectedMode,
        urlInput: state.local.urlInput,
        searchQuery: state.local.searchQuery,
        searchResults: state.local.searchResults,
        isSearching: state.local.isSearching,
    };
}

function _render(): void {
    Ubi.ui.render(() => renderControlsUI(_toUIState(), actions), 'player');
}

// ── ECS System (transform など state 管理外の追従のみ) ──

export const ControlsSystem: System = (_entities: Entity[], _dt: number, events: WorkerEvent[]) => {
    for (const event of events) {
        if (event.type === 'entity:video-player:screen') {
            const entity = event.payload as {
                id?: string;
                transform?: { x: number; y: number; z: number; w: number; h: number; scale: number; rotation: number };
            };
            if (entity.id) state.local.screenEntityId = entity.id;
            if (entity.transform) {
                state.local.screenW = entity.transform.w;
                state.local.screenH = entity.transform.h;
                state.local.screenTransform = entity.transform;
            }
        }
    }
};

// ── 初期化 ───────────────────────────────────────────

export function initControls(): void {
    state.local.apiBase = _apiBase();
    Ubi.log(
        `[Controls:init] playlist=${state.local.playlist.length} isPlaying=${state.local.isPlaying} currentTime=${state.local.currentTime}`,
        'info',
    );
    // applyEntityData は onChange 登録前に実行されるため currentTime が反映されない。
    // 後から参加したユーザーが正しい再生位置を表示できるよう手動で初期化する。
    if (state.local.currentTime > 0) {
        state.local.lastSyncedTime = state.local.currentTime;
        state.local.lastSyncedAt = Date.now();
    }
    _render();
    // 進行バー推定は時計依存なので、state 変化がなくても再描画を打つ必要がある
    setInterval(_render, 500);
}

// 未使用関数警告の回避 (format ヘルパは UI 側で使用)
void _fmt;
