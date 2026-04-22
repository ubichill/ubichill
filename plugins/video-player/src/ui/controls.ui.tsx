/**
 * video-player:controls の UI レイヤー。
 *
 * System から渡された state と actions のみを参照し、副作用は持たない純粋関数。
 * 状態遷移・通信・タイマーなどはすべて system/controls.ts 側が担当する。
 */

import type { JSX } from '@ubichill/sdk/jsx-runtime';
import {
    ExpandIcon,
    ListIcon,
    PauseIcon,
    PlayIcon,
    PlaySmallIcon,
    RepeatIcon,
    RepeatOneIcon,
    SearchIcon,
    ShuffleIcon,
    SkipNextIcon,
    SkipPrevIcon,
    TrashIcon,
    VideoIcon,
    VolumeHighIcon,
    VolumeLowIcon,
    VolumeMediumIcon,
    VolumeMuteIcon,
} from '../icons';
import type { LoopMode, SearchResult, Track } from '../types';

// ── 公開 API ────────────────────────────────────────

export interface ControlsUIState {
    playlist: Track[];
    currentIndex: number;
    isPlaying: boolean;
    isVisible: boolean;
    volume: number;
    loop: LoopMode;
    shuffle: boolean;
    duration: number;
    currentTime: number;
    showPlaylist: boolean;
    selectedMode: 'live' | 'video';
    urlInput: string;
    searchQuery: string;
    searchResults: SearchResult[];
    isSearching: boolean;
}

export interface ControlsUIActions {
    onSeek: (time: number) => void;
    onPlayToggle: () => void;
    onPrev: () => void;
    onNext: () => void;
    onShuffleToggle: () => void;
    onLoopCycle: () => void;
    onVolumeChange: (v: number) => void;
    onVisibilityToggle: () => void;
    onResize: () => void;
    onShowPlaylistToggle: () => void;
    onSelectMode: (mode: 'live' | 'video') => void;
    onUrlInputChange: (v: string) => void;
    onAddFromUrl: () => void;
    onSearchQueryChange: (v: string) => void;
    onDoSearch: () => void;
    onAddSearchResult: (result: SearchResult) => void;
    onSelectTrack: (index: number) => void;
    onRemoveTrack: (index: number) => void;
}

// ── 内部ヘルパー ─────────────────────────────────────

const _fmt = (sec: number): string => {
    if (!Number.isFinite(sec) || sec <= 0) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
};

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
}): JSX.Element {
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

// ── メインレンダラ ───────────────────────────────────

export function renderControlsUI(state: ControlsUIState, actions: ControlsUIActions): JSX.Element {
    const track = state.playlist[state.currentIndex];
    const ct = state.currentTime;
    const progress = state.duration > 0 ? (ct / state.duration) * 100 : 0;
    const isLive = track?.mode === 'live';

    const VolumeIcon =
        state.volume === 0
            ? VolumeMuteIcon
            : state.volume < 0.3
              ? VolumeLowIcon
              : state.volume < 0.7
                ? VolumeMediumIcon
                : VolumeHighIcon;
    const LoopIconComp = state.loop === 'track' ? RepeatOneIcon : RepeatIcon;

    return (
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
                        max={String(state.duration > 0 ? Math.floor(state.duration) : 100)}
                        step="1"
                        value={String(Math.round(ct))}
                        disabled={state.duration <= 0 || isLive}
                        style={{
                            width: '100%',
                            height: '4px',
                            marginBottom: '8px',
                            display: 'block',
                            cursor: state.duration <= 0 || isLive ? 'default' : 'pointer',
                            accentColor: '#007aff',
                            appearance: 'none',
                            background: `linear-gradient(to right, #007aff ${progress}%, rgba(255,255,255,0.2) ${progress}%)`,
                            borderRadius: '2px',
                            outline: 'none',
                        }}
                        onUbiInput={(val: unknown) => actions.onSeek(Number.parseFloat(String(val)))}
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
                                    {_fmt(ct)} / {state.duration > 0 ? _fmt(state.duration) : isLive ? 'LIVE' : '--:--'}
                                </div>
                            </div>
                        </div>

                        {/* 中央: 再生コントロール */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <CtrlBtn disabled={state.playlist.length === 0} onClick={actions.onPrev}>
                                <SkipPrevIcon size={18} />
                            </CtrlBtn>

                            <button
                                type="button"
                                disabled={state.playlist.length === 0}
                                style={{
                                    background: '#007aff',
                                    border: 'none',
                                    color: '#fff',
                                    cursor: state.playlist.length === 0 ? 'not-allowed' : 'pointer',
                                    width: '36px',
                                    height: '36px',
                                    borderRadius: '50%',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    boxShadow: '0 2px 8px rgba(0,122,255,0.3)',
                                    flexShrink: '0',
                                    opacity: state.playlist.length === 0 ? '0.5' : '1',
                                }}
                                onUbiClick={actions.onPlayToggle}
                            >
                                {state.isPlaying ? <PauseIcon size={20} /> : <PlayIcon size={20} />}
                            </button>

                            <CtrlBtn disabled={state.playlist.length === 0} onClick={actions.onNext}>
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
                            <CtrlBtn active={state.shuffle} onClick={actions.onShuffleToggle}>
                                <ShuffleIcon size={16} />
                            </CtrlBtn>

                            <CtrlBtn active={state.loop !== 'none'} onClick={actions.onLoopCycle}>
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
                                value={String(state.volume)}
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
                                onUbiInput={(val: unknown) => actions.onVolumeChange(Number.parseFloat(String(val)))}
                            />

                            <CtrlBtn active={state.isVisible} onClick={actions.onVisibilityToggle}>
                                <VideoIcon size={16} />
                            </CtrlBtn>

                            <CtrlBtn onClick={actions.onResize}>
                                <ExpandIcon size={16} />
                            </CtrlBtn>

                            <CtrlBtn active={state.showPlaylist} onClick={actions.onShowPlaylistToggle}>
                                <ListIcon size={16} />
                            </CtrlBtn>
                        </div>
                    </div>
                </div>

                {/* ── プレイリストパネル ── */}
                {state.showPlaylist && (
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
                                Playlist ({state.playlist.length})
                            </span>

                            <div style={{ display: 'flex', gap: '0', flexShrink: '0' }}>
                                <button
                                    type="button"
                                    style={{
                                        background: state.selectedMode === 'live' ? '#ff4444' : '#333',
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
                                    onUbiClick={() => actions.onSelectMode('live')}
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
                                        background: state.selectedMode === 'video' ? '#4444ff' : '#333',
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
                                    onUbiClick={() => actions.onSelectMode('video')}
                                >
                                    <VideoIcon size={12} />
                                    Video
                                </button>
                            </div>

                            <input
                                type="text"
                                placeholder="YouTube URL or ID..."
                                value={state.urlInput}
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
                                onUbiInput={(val: unknown) => actions.onUrlInputChange(String(val))}
                            />
                            <button
                                type="button"
                                disabled={state.isSearching}
                                style={{
                                    background: 'rgba(255,255,255,0.1)',
                                    border: 'none',
                                    color: 'rgba(255,255,255,0.8)',
                                    cursor: state.isSearching ? 'not-allowed' : 'pointer',
                                    padding: '5px 10px',
                                    borderRadius: '6px',
                                    fontSize: '14px',
                                    opacity: state.isSearching ? '0.5' : '1',
                                    flexShrink: '0',
                                }}
                                onUbiClick={actions.onAddFromUrl}
                            >
                                {state.isSearching ? '...' : '+'}
                            </button>

                            <input
                                type="text"
                                placeholder="Search YouTube..."
                                value={state.searchQuery}
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
                                onUbiInput={(val: unknown) => actions.onSearchQueryChange(String(val))}
                            />
                            <button
                                type="button"
                                disabled={state.isSearching}
                                style={{
                                    background: 'rgba(255,255,255,0.1)',
                                    border: 'none',
                                    color: 'rgba(255,255,255,0.8)',
                                    cursor: state.isSearching ? 'not-allowed' : 'pointer',
                                    padding: '5px 10px',
                                    borderRadius: '6px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    opacity: state.isSearching ? '0.5' : '1',
                                    flexShrink: '0',
                                }}
                                onUbiClick={actions.onDoSearch}
                            >
                                {state.isSearching ? '...' : <SearchIcon size={14} />}
                            </button>
                        </div>

                        {/* 検索結果 */}
                        {state.searchResults.length > 0 && (
                            <div style={{ overflowY: 'auto', padding: '8px' }}>
                                {state.searchResults.map((result) => (
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
                                            onUbiClick={() => actions.onAddSearchResult(result)}
                                        >
                                            +
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* プレイリスト */}
                        <div style={{ flex: '1', overflowY: 'auto', padding: '8px' }}>
                            {state.playlist.length === 0 ? (
                                <div style={{ padding: '24px', textAlign: 'center' }}>
                                    <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)' }}>
                                        No tracks in playlist
                                    </div>
                                </div>
                            ) : (
                                state.playlist.map((t, i) => (
                                    <div
                                        key={t.id}
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '8px',
                                            padding: '6px 8px',
                                            borderRadius: '6px',
                                            marginBottom: '4px',
                                            background:
                                                i === state.currentIndex ? 'rgba(0,122,255,0.2)' : 'transparent',
                                            cursor: 'pointer',
                                        }}
                                        onUbiClick={() => actions.onSelectTrack(i)}
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
                                        {i === state.currentIndex && (
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
                                            onUbiClick={() => actions.onRemoveTrack(i)}
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
    );
}
