/**
 * video-player:controls Worker
 *
 * 責務: UI 描画 + 状態管理のみ。メディア操作は行わない。
 * 状態変更は Ubi.world.updateEntity(screenEntityId, {data: patch}) 経由で
 * screen worker に伝達する。ECS のシャローマージにより差分のみ送信できる。
 *
 * - watchEntityTypes: ['video-player:screen'] で screen entity の変化を受信
 * - setInterval で進行バーをスムーズに更新（media:timeUpdate なし）
 */

import type { Entity, RpcNetFetchResult, System, WorkerEvent } from '@ubichill/sdk';
import type { JSX } from '@ubichill/sdk/jsx-runtime';

// ── 型 ──────────────────────────────────────────────

interface Track {
    id: string;
    title: string;
    thumbnail: string;
    duration: number;
    mode: 'live' | 'video';
}

interface SearchResult {
    id: string;
    title: string;
    thumbnail: string;
    duration: number;
}

type LoopMode = 'none' | 'playlist' | 'track';

// ── 状態 ─────────────────────────────────────────────

// screen entity から同期される状態
let screenEntityId: string | null = null;
let playlist: Track[] = [];
let currentIndex = 0;
let isPlaying = false;
let isVisible = false;
let volume = 0;
let loop: LoopMode = 'none';
let shuffle = false;
let duration = 0;
let apiBase = '';
let seekNonce = 0;
let screenW = 640;
let screenH = 360;
let screenTransform: { x: number; y: number; z: number; w: number; h: number; scale: number; rotation: number } | null =
    null;

// 時刻推定（media:timeUpdate なしでスムーズな進行バー）
let lastSyncedTime = 0;
let lastSyncedAt = 0;

// UI ローカル状態
let showPlaylist = true;
let selectedMode: 'live' | 'video' = 'video';
let urlInput = '';
let searchQuery = '';
let searchResults: SearchResult[] = [];
let isSearching = false;

// ── 時刻推定 ─────────────────────────────────────────

function _estimatedTime(): number {
    if (!isPlaying || duration <= 0) return lastSyncedTime;
    const elapsed = (Date.now() - lastSyncedAt) / 1000;
    return Math.min(lastSyncedTime + elapsed, duration);
}

// ── 初期化 ───────────────────────────────────────────

void (async () => {
    try {
        const screens = await Ubi.world.queryEntities('video-player:screen');
        const screen = screens[0];
        if (screen) {
            screenEntityId = screen.id;
            const d = screen.data as Partial<{
                playlist: Track[];
                currentIndex: number;
                isPlaying: boolean;
                isVisible: boolean;
                volume: number;
                loop: LoopMode;
                shuffle: boolean;
                currentTime: number;
                duration: number;
                apiBase: string;
                seekNonce: number;
            }>;
            playlist = d.playlist ?? [];
            currentIndex = d.currentIndex ?? 0;
            isPlaying = d.isPlaying ?? false;
            isVisible = d.isVisible ?? false;
            volume = d.volume ?? 0;
            loop = d.loop ?? 'none';
            shuffle = d.shuffle ?? false;
            duration = d.duration ?? 0;
            apiBase = d.apiBase ?? '';
            seekNonce = (d.seekNonce as number | undefined) ?? 0;
            lastSyncedTime = d.currentTime ?? 0;
            lastSyncedAt = Date.now();
            screenW = screen.transform?.w ?? 640;
            screenH = screen.transform?.h ?? 360;
            screenTransform = screen.transform ?? null;
        }
    } catch (err) {
        Ubi.log(`[Controls] init error: ${String(err)}`, 'error');
    }

    renderUI();

    // 500ms ごとに進行バーを再描画
    setInterval(renderUI, 500);
})();

// ── screen entity への状態反映 ────────────────────────

function _updateScreen(patch: Record<string, unknown>): void {
    if (!screenEntityId) return;
    void Ubi.world.updateEntity(screenEntityId, { data: patch });
}

// サイズプリセット: SD → qHD → HD → SD の順でサイクル
const SIZE_PRESETS: [number, number][] = [
    [640, 360],
    [960, 540],
    [1280, 720],
];

function _resizeScreen(): void {
    if (!screenEntityId || !screenTransform) return;
    const current = SIZE_PRESETS.findIndex(([w]) => w === screenW);
    const next = SIZE_PRESETS[(current + 1) % SIZE_PRESETS.length];
    [screenW, screenH] = next;
    void Ubi.world.updateEntity(screenEntityId, {
        transform: { ...screenTransform, w: screenW, h: screenH },
    });
    screenTransform = { ...screenTransform, w: screenW, h: screenH };
    renderUI();
}

// ── API ヘルパー ─────────────────────────────────────

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

async function _addFromUrl(): Promise<void> {
    const videoId = _extractYouTubeId(urlInput.trim());
    if (!videoId) return;
    isSearching = true;
    renderUI();
    try {
        const res = (await Ubi.network.fetch(`${apiBase}/info/${videoId}`)) as RpcNetFetchResult;
        const info = res.ok ? (JSON.parse(res.body) as { title?: string; thumbnail?: string; duration?: number }) : {};
        const newTrack: Track = {
            id: videoId,
            title: info.title ?? urlInput,
            thumbnail: info.thumbnail ?? `https://i.ytimg.com/vi/${videoId}/default.jpg`,
            duration: info.duration ?? 0,
            mode: selectedMode,
        };
        playlist = [...playlist, newTrack];
        urlInput = '';
        _updateScreen({ playlist });
    } catch (err) {
        Ubi.log(`[Controls] addFromUrl error: ${String(err)}`, 'warn');
        playlist = [
            ...playlist,
            {
                id: videoId,
                title: urlInput,
                thumbnail: `https://i.ytimg.com/vi/${videoId}/default.jpg`,
                duration: 0,
                mode: selectedMode,
            },
        ];
        urlInput = '';
        _updateScreen({ playlist });
    }
    isSearching = false;
    renderUI();
}

async function _doSearch(): Promise<void> {
    if (!searchQuery.trim()) return;
    isSearching = true;
    renderUI();
    try {
        const res = (await Ubi.network.fetch(
            `${apiBase}/search?q=${encodeURIComponent(searchQuery)}&limit=10`,
        )) as RpcNetFetchResult;
        if (res.ok) searchResults = JSON.parse(res.body) as SearchResult[];
    } catch (err) {
        Ubi.log(`[Controls] search error: ${String(err)}`, 'warn');
    }
    isSearching = false;
    renderUI();
}

// ── SVG アイコン ──────────────────────────────────────

const PlayIcon = ({ size = 24 }: { size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
        <path d="M8 5v14l11-7z" />
    </svg>
);
const PauseIcon = ({ size = 24 }: { size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
        <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
    </svg>
);
const SkipPrevIcon = ({ size = 24 }: { size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
        <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" />
    </svg>
);
const SkipNextIcon = ({ size = 24 }: { size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
        <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
    </svg>
);
const RepeatIcon = ({ size = 16 }: { size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
        <path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z" />
    </svg>
);
const RepeatOneIcon = ({ size = 16 }: { size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
        <path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4zm-4-2V9h-1l-2 1v1h1.5v4H13z" />
    </svg>
);
const ShuffleIcon = ({ size = 16 }: { size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
        <path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z" />
    </svg>
);
const VolumeHighIcon = ({ size = 16 }: { size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
        <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
    </svg>
);
const VolumeMediumIcon = ({ size = 16 }: { size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
        <path d="M18.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM5 9v6h4l5 5V4L9 9H5z" />
    </svg>
);
const VolumeLowIcon = ({ size = 16 }: { size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
        <path d="M7 9v6h4l5 5V4l-5 5H7z" />
    </svg>
);
const VolumeMuteIcon = ({ size = 16 }: { size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
        <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z" />
    </svg>
);
const VideoIcon = ({ size = 16 }: { size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
        <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z" />
    </svg>
);
const ListIcon = ({ size = 16 }: { size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
        <path d="M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z" />
    </svg>
);
const ExpandIcon = ({ size = 16 }: { size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
        <path d="M15 3l2.3 2.3-2.89 2.87 1.42 1.42L18.7 6.7 21 9V3h-6zM3 9l2.3-2.3 2.87 2.89 1.42-1.42L6.7 5.3 9 3H3v6zm6 12l-2.3-2.3 2.89-2.87-1.42-1.42L5.3 17.3 3 15v6h6zm12-6l-2.3 2.3-2.87-2.89-1.42 1.42 2.89 2.87L15 21h6v-6z" />
    </svg>
);
const TrashIcon = ({ size = 14 }: { size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
        <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
    </svg>
);
const PlaySmallIcon = () => (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
        <path d="M8 5v14l11-7z" />
    </svg>
);
const SearchIcon = ({ size = 14 }: { size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
        <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
    </svg>
);

// ── ボタンコンポーネント ────────────────────────────────

const _btnBase: Record<string, string> = {
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    padding: '6px',
    borderRadius: '6px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: '0',
};

function CtrlBtn({
    children,
    onClick,
    disabled = false,
    active = false,
}: {
    children: JSX.Element | JSX.Element[] | null;
    onClick: () => void;
    disabled?: boolean;
    active?: boolean;
}) {
    return (
        <button
            type="button"
            disabled={disabled}
            style={{
                ..._btnBase,
                color: disabled ? 'rgba(255,255,255,0.3)' : active ? '#007aff' : 'rgba(255,255,255,0.8)',
                opacity: disabled ? '0.3' : '1',
                cursor: disabled ? 'not-allowed' : 'pointer',
            }}
            onUbiClick={onClick}
        >
            {children}
        </button>
    );
}

// ── UI レンダリング ───────────────────────────────────

function renderUI(): void {
    const track = playlist[currentIndex];
    const ct = _estimatedTime();
    const progress = duration > 0 ? (ct / duration) * 100 : 0;

    const VolumeIcon =
        volume === 0 ? VolumeMuteIcon : volume < 0.3 ? VolumeLowIcon : volume < 0.7 ? VolumeMediumIcon : VolumeHighIcon;
    const LoopIconComp = loop === 'track' ? RepeatOneIcon : RepeatIcon;

    Ubi.ui.render(
        () => (
            <div
                style={{
                    position: 'relative',
                    width: '100%',
                    pointerEvents: 'auto',
                    fontFamily: 'system-ui, -apple-system, sans-serif',
                    userSelect: 'none',
                }}
            >
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {/* ── コントロールバー ── */}
                    <div
                        style={{
                            background: 'rgba(20,20,20,0.95)',
                            backdropFilter: 'blur(10px)',
                            borderRadius: '12px',
                            padding: '8px 12px',
                            boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
                            border: '1px solid rgba(255,255,255,0.1)',
                        }}
                    >
                        {/* シークバー */}
                        <input
                            type="range"
                            min="0"
                            max={String(duration > 0 ? Math.floor(duration) : 100)}
                            step="1"
                            value={String(Math.round(ct))}
                            disabled={duration <= 0 || playlist[currentIndex]?.mode === 'live'}
                            style={{
                                width: '100%',
                                height: '4px',
                                marginBottom: '8px',
                                display: 'block',
                                cursor:
                                    duration <= 0 || playlist[currentIndex]?.mode === 'live' ? 'default' : 'pointer',
                                accentColor: '#007aff',
                                appearance: 'none',
                                background: `linear-gradient(to right, #007aff ${progress}%, rgba(255,255,255,0.2) ${progress}%)`,
                                borderRadius: '2px',
                                outline: 'none',
                            }}
                            onUbiInput={(val: unknown) => {
                                const t = Number.parseFloat(String(val));
                                lastSyncedTime = t;
                                lastSyncedAt = Date.now();
                                seekNonce = Date.now();
                                _updateScreen({ seekNonce, currentTime: t });
                                renderUI();
                            }}
                        />

                        {/* コントロール行 */}
                        <div
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                gap: '12px',
                            }}
                        >
                            {/* 左: トラック情報 */}
                            <div
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                    flex: '1',
                                    minWidth: '0',
                                }}
                            >
                                {track?.thumbnail && (
                                    <img
                                        src={track.thumbnail}
                                        alt=""
                                        style={{
                                            width: '36px',
                                            height: '36px',
                                            borderRadius: '4px',
                                            objectFit: 'cover',
                                            flexShrink: '0',
                                        }}
                                    />
                                )}
                                <div style={{ display: 'flex', flexDirection: 'column', minWidth: '0' }}>
                                    <div
                                        style={{
                                            fontSize: '12px',
                                            fontWeight: '600',
                                            color: '#fff',
                                            whiteSpace: 'nowrap',
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                        }}
                                    >
                                        {track ? track.title || track.id : '---'}
                                    </div>
                                    <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.6)' }}>
                                        {_fmt(ct)} /{' '}
                                        {duration > 0 ? _fmt(duration) : track?.mode === 'live' ? 'LIVE' : '--:--'}
                                    </div>
                                </div>
                            </div>

                            {/* 中央: 再生コントロール */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <CtrlBtn
                                    disabled={playlist.length === 0}
                                    onClick={() => {
                                        const prev = currentIndex > 0 ? currentIndex - 1 : playlist.length - 1;
                                        currentIndex = prev;
                                        lastSyncedTime = 0;
                                        lastSyncedAt = Date.now();
                                        duration = 0;
                                        _updateScreen({ currentIndex: prev, currentTime: 0, isPlaying: true });
                                        renderUI();
                                    }}
                                >
                                    <SkipPrevIcon size={18} />
                                </CtrlBtn>

                                <button
                                    type="button"
                                    disabled={playlist.length === 0}
                                    style={{
                                        background: '#007aff',
                                        border: 'none',
                                        color: '#fff',
                                        cursor: playlist.length === 0 ? 'not-allowed' : 'pointer',
                                        width: '36px',
                                        height: '36px',
                                        borderRadius: '50%',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        boxShadow: '0 2px 8px rgba(0,122,255,0.3)',
                                        flexShrink: '0',
                                        opacity: playlist.length === 0 ? '0.5' : '1',
                                    }}
                                    onUbiClick={() => {
                                        isPlaying = !isPlaying;
                                        if (isPlaying) {
                                            lastSyncedAt = Date.now();
                                        } else {
                                            lastSyncedTime = _estimatedTime();
                                        }
                                        _updateScreen({ isPlaying, currentTime: lastSyncedTime });
                                        renderUI();
                                    }}
                                >
                                    {isPlaying ? <PauseIcon size={20} /> : <PlayIcon size={20} />}
                                </button>

                                <CtrlBtn
                                    disabled={playlist.length === 0}
                                    onClick={() => {
                                        const next = currentIndex < playlist.length - 1 ? currentIndex + 1 : 0;
                                        currentIndex = next;
                                        lastSyncedTime = 0;
                                        lastSyncedAt = Date.now();
                                        duration = 0;
                                        _updateScreen({ currentIndex: next, currentTime: 0, isPlaying: true });
                                        renderUI();
                                    }}
                                >
                                    <SkipNextIcon size={18} />
                                </CtrlBtn>
                            </div>

                            {/* 右: その他コントロール */}
                            <div
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                    flex: '1',
                                    justifyContent: 'flex-end',
                                }}
                            >
                                <CtrlBtn
                                    active={shuffle}
                                    onClick={() => {
                                        shuffle = !shuffle;
                                        _updateScreen({ shuffle });
                                        renderUI();
                                    }}
                                >
                                    <ShuffleIcon size={16} />
                                </CtrlBtn>

                                <CtrlBtn
                                    active={loop !== 'none'}
                                    onClick={() => {
                                        loop = loop === 'none' ? 'playlist' : loop === 'playlist' ? 'track' : 'none';
                                        _updateScreen({ loop });
                                        renderUI();
                                    }}
                                >
                                    <LoopIconComp size={16} />
                                </CtrlBtn>

                                <CtrlBtn onClick={() => {}}>
                                    <VolumeIcon size={16} />
                                </CtrlBtn>

                                <input
                                    type="range"
                                    min="0"
                                    max="1"
                                    step="0.01"
                                    value={String(volume)}
                                    style={{
                                        width: '60px',
                                        height: '3px',
                                        background: 'rgba(255,255,255,0.2)',
                                        borderRadius: '2px',
                                        outline: 'none',
                                        cursor: 'pointer',
                                        appearance: 'none',
                                        accentColor: '#007aff',
                                    }}
                                    onUbiInput={(val: unknown) => {
                                        volume = Number.parseFloat(String(val));
                                        _updateScreen({ volume });
                                        renderUI();
                                    }}
                                />

                                <CtrlBtn
                                    active={isVisible}
                                    onClick={() => {
                                        isVisible = !isVisible;
                                        _updateScreen({ isVisible });
                                        renderUI();
                                    }}
                                >
                                    <VideoIcon size={16} />
                                </CtrlBtn>

                                <CtrlBtn onClick={_resizeScreen}>
                                    <ExpandIcon size={16} />
                                </CtrlBtn>

                                <CtrlBtn
                                    active={showPlaylist}
                                    onClick={() => {
                                        showPlaylist = !showPlaylist;
                                        renderUI();
                                    }}
                                >
                                    <ListIcon size={16} />
                                </CtrlBtn>
                            </div>
                        </div>
                    </div>

                    {/* ── プレイリストパネル ── */}
                    {showPlaylist && (
                        <div
                            style={{
                                maxHeight: '300px',
                                background: 'rgba(20,20,20,0.95)',
                                backdropFilter: 'blur(10px)',
                                borderRadius: '12px',
                                boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
                                border: '1px solid rgba(255,255,255,0.1)',
                                overflow: 'hidden',
                                display: 'flex',
                                flexDirection: 'column',
                            }}
                        >
                            {/* ヘッダー */}
                            <div
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                    padding: '8px 12px',
                                    borderBottom: '1px solid rgba(255,255,255,0.1)',
                                }}
                            >
                                <span style={{ fontSize: '12px', fontWeight: '600', color: '#fff', flexShrink: '0' }}>
                                    Playlist ({playlist.length})
                                </span>

                                {/* モード切り替え */}
                                <div style={{ display: 'flex', gap: '0', flexShrink: '0' }}>
                                    <button
                                        type="button"
                                        style={{
                                            background: selectedMode === 'live' ? '#ff4444' : '#333',
                                            border: 'none',
                                            borderRadius: '4px 0 0 4px',
                                            color: '#fff',
                                            padding: '6px 12px',
                                            fontSize: '12px',
                                            cursor: 'pointer',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '6px',
                                        }}
                                        onUbiClick={() => {
                                            selectedMode = 'live';
                                            renderUI();
                                        }}
                                    >
                                        <span
                                            style={{
                                                width: '7px',
                                                height: '7px',
                                                borderRadius: '50%',
                                                background: '#fff',
                                                display: 'inline-block',
                                                flexShrink: '0',
                                            }}
                                        />
                                        Live
                                    </button>
                                    <button
                                        type="button"
                                        style={{
                                            background: selectedMode === 'video' ? '#4444ff' : '#333',
                                            border: 'none',
                                            borderRadius: '0 4px 4px 0',
                                            color: '#fff',
                                            padding: '6px 12px',
                                            fontSize: '12px',
                                            cursor: 'pointer',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '6px',
                                        }}
                                        onUbiClick={() => {
                                            selectedMode = 'video';
                                            renderUI();
                                        }}
                                    >
                                        <VideoIcon size={12} />
                                        Video
                                    </button>
                                </div>

                                {/* URL 入力 */}
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
                                    onUbiInput={(val: unknown) => {
                                        urlInput = String(val);
                                    }}
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
                                        flexShrink: '0',
                                    }}
                                    onUbiClick={() => {
                                        void _addFromUrl();
                                    }}
                                >
                                    {isSearching ? '...' : '+'}
                                </button>

                                {/* 検索 */}
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
                                    onUbiInput={(val: unknown) => {
                                        searchQuery = String(val);
                                    }}
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
                                        flexShrink: '0',
                                    }}
                                    onUbiClick={() => {
                                        void _doSearch();
                                    }}
                                >
                                    {isSearching ? '...' : <SearchIcon size={14} />}
                                </button>
                            </div>

                            {/* 検索結果 */}
                            {searchResults.length > 0 && (
                                <div style={{ overflowY: 'auto', padding: '8px' }}>
                                    {searchResults.map((result) => (
                                        <div
                                            key={result.id}
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
                                                src={result.thumbnail}
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
                                                    {result.title}
                                                </div>
                                                <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.6)' }}>
                                                    {_fmt(result.duration)}
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
                                                onUbiClick={() => {
                                                    playlist = [
                                                        ...playlist,
                                                        {
                                                            id: result.id,
                                                            title: result.title,
                                                            thumbnail: result.thumbnail,
                                                            duration: result.duration,
                                                            mode: selectedMode,
                                                        },
                                                    ];
                                                    searchResults = [];
                                                    searchQuery = '';
                                                    _updateScreen({ playlist });
                                                    renderUI();
                                                }}
                                            >
                                                +
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* プレイリスト */}
                            <div style={{ flex: '1', overflowY: 'auto', padding: '8px' }}>
                                {playlist.length === 0 ? (
                                    <div style={{ padding: '24px', textAlign: 'center' }}>
                                        <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)' }}>
                                            No tracks in playlist
                                        </div>
                                    </div>
                                ) : (
                                    playlist.map((t, i) => (
                                        <div
                                            key={t.id}
                                            style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '8px',
                                                padding: '6px 8px',
                                                borderRadius: '6px',
                                                marginBottom: '4px',
                                                background: i === currentIndex ? 'rgba(0,122,255,0.2)' : 'transparent',
                                                cursor: 'pointer',
                                            }}
                                            onUbiClick={() => {
                                                currentIndex = i;
                                                lastSyncedTime = 0;
                                                lastSyncedAt = Date.now();
                                                duration = 0;
                                                isPlaying = true;
                                                _updateScreen({ currentIndex: i, currentTime: 0, isPlaying: true });
                                                renderUI();
                                            }}
                                        >
                                            <img
                                                src={t.thumbnail}
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
                                                    <span
                                                        style={{
                                                            display: 'inline-block',
                                                            width: '6px',
                                                            height: '6px',
                                                            borderRadius: '50%',
                                                            background: t.mode === 'live' ? '#ff4444' : '#4444ff',
                                                            marginRight: '5px',
                                                            flexShrink: '0',
                                                            verticalAlign: 'middle',
                                                        }}
                                                    />
                                                    {t.title}
                                                </div>
                                                <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.6)' }}>
                                                    {t.duration > 0
                                                        ? _fmt(t.duration)
                                                        : t.mode === 'live'
                                                          ? 'LIVE'
                                                          : '--:--'}
                                                </div>
                                            </div>
                                            {i === currentIndex && (
                                                <span style={{ color: '#007aff', flexShrink: '0' }}>
                                                    <PlaySmallIcon />
                                                </span>
                                            )}
                                            <button
                                                type="button"
                                                style={{
                                                    background: 'transparent',
                                                    border: 'none',
                                                    color: 'rgba(255,255,255,0.6)',
                                                    cursor: 'pointer',
                                                    padding: '4px 8px',
                                                    borderRadius: '4px',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                }}
                                                onUbiClick={() => {
                                                    const newList = playlist.filter((_, idx) => idx !== i);
                                                    playlist = newList;
                                                    const newIdx =
                                                        currentIndex >= newList.length
                                                            ? Math.max(0, newList.length - 1)
                                                            : currentIndex;
                                                    currentIndex = newIdx;
                                                    _updateScreen({ playlist: newList, currentIndex: newIdx });
                                                    renderUI();
                                                }}
                                            >
                                                <TrashIcon size={14} />
                                            </button>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        ),
        'player',
    );
}

// ── System ───────────────────────────────────────────

const ControlsSystem: System = (_entities: Entity[], _dt: number, events: WorkerEvent[]) => {
    for (const event of events) {
        // screen entity の状態変化を受信して UI を同期
        if (event.type === 'entity:video-player:screen') {
            const entity = event.payload as { data?: Record<string, unknown> };
            const d = entity.data;
            if (!d) continue;

            const wasPlaying = isPlaying;
            const prevSeekNonce = seekNonce;
            playlist = (d.playlist as Track[]) ?? playlist;
            currentIndex = (d.currentIndex as number) ?? currentIndex;
            isPlaying = (d.isPlaying as boolean) ?? isPlaying;
            isVisible = (d.isVisible as boolean) ?? isVisible;
            volume = (d.volume as number) ?? volume;
            loop = (d.loop as LoopMode) ?? loop;
            shuffle = (d.shuffle as boolean) ?? shuffle;
            duration = (d.duration as number) ?? duration;
            apiBase = (d.apiBase as string) ?? apiBase;
            seekNonce = (d.seekNonce as number) ?? seekNonce;

            // 再生開始・seekNonce 変化・3秒以上のズレ時に時刻推定をリセット
            const syncedTime = (d.currentTime as number) ?? lastSyncedTime;
            if (!wasPlaying && isPlaying) {
                lastSyncedTime = syncedTime;
                lastSyncedAt = Date.now();
            } else if (seekNonce !== prevSeekNonce || Math.abs(syncedTime - lastSyncedTime) > 3) {
                lastSyncedTime = syncedTime;
                lastSyncedAt = Date.now();
            }

            renderUI();
        }

        // screen worker からの再生位置ブロードキャストで進行バーを同期
        if (event.type === 'vp:timeSync') {
            const p = event.payload as { data: { currentTime: number; currentIndex: number } };
            if (p.data.currentIndex === currentIndex) {
                lastSyncedTime = p.data.currentTime;
                lastSyncedAt = Date.now();
            }
        }
    }
};

Ubi.registerSystem(ControlsSystem);
