/**
 * video-player:controls Worker — 再生コントロール UI。
 *
 * watchScope='parent' で screen の state を共有 (Ubi.state.sync 経由)。
 * 再生・一時停止 / シーク / 前後トラック / loop / shuffle / 音量のみを担当。
 * プレイリスト表示・検索は別 Entity (playlist / search)。
 */

import type { Entity, System } from '@ubichill/sdk';
import {
    PauseIcon,
    PlayIcon,
    RepeatIcon,
    RepeatOneIcon,
    ShuffleIcon,
    SkipNextIcon,
    SkipPrevIcon,
    VolumeHighIcon,
    VolumeLowIcon,
    VolumeMediumIcon,
    VolumeMuteIcon,
} from './icons';
import type { LoopMode, Track } from './types';

const state = Ubi.state.define({
    playlist: Ubi.state.sync([] as Track[]),
    currentIndex: Ubi.state.sync(0),
    isPlaying: Ubi.state.sync(false),
    loop: Ubi.state.sync<LoopMode>('none'),
    shuffle: Ubi.state.sync(false),
    currentTime: Ubi.state.sync(0),
    duration: Ubi.state.sync(0),
    seekNonce: Ubi.state.sync(0),
    myVolume: Ubi.state.sync(0.7, { perUser: true }),
    // ローカル: 進行バー推定用クロック
    lastSyncedTime: 0,
    lastSyncedAt: 0,
});

// ── 進行バー時計の起点同期 ──────────────────────────
state.onChange('currentTime', (next) => {
    state.local.lastSyncedTime = next;
    state.local.lastSyncedAt = Date.now();
});
state.onChange('isPlaying', (playing) => {
    if (playing) state.local.lastSyncedAt = Date.now();
    else state.local.lastSyncedTime = estimatedTime();
    render();
});
state.onChange('currentIndex', () => {
    state.local.lastSyncedTime = 0;
    state.local.lastSyncedAt = Date.now();
    render();
});
state.onChange('seekNonce', () => {
    state.local.lastSyncedTime = state.local.currentTime;
    state.local.lastSyncedAt = Date.now();
    render();
});
state.onChange('playlist', render);
state.onChange('loop', render);
state.onChange('shuffle', render);
state.onChange('duration', render);
state.onChange('myVolume', render);

// ── ヘルパー ────────────────────────────────────────
const fmt = (sec: number): string => {
    if (!Number.isFinite(sec) || sec <= 0) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
};

function estimatedTime(): number {
    if (!state.local.isPlaying || state.local.duration <= 0) return state.local.lastSyncedTime;
    const elapsed = (Date.now() - state.local.lastSyncedAt) / 1000;
    return Math.min(state.local.lastSyncedTime + elapsed, state.local.duration);
}

// ── アクション (純粋に state を書き換えるだけ) ───────
const onSeek = (time: number): void => {
    state.local.currentTime = time;
    state.local.seekNonce = Date.now();
};
const onPlayToggle = (): void => {
    const next = !state.local.isPlaying;
    state.local.currentTime = next ? state.local.lastSyncedTime : estimatedTime();
    state.local.isPlaying = next;
};
const onPrev = (): void => {
    const len = state.local.playlist.length;
    if (len === 0) return;
    state.local.currentTime = 0;
    state.local.currentIndex = state.local.currentIndex > 0 ? state.local.currentIndex - 1 : len - 1;
    state.local.isPlaying = true;
};
const onNext = (): void => {
    const len = state.local.playlist.length;
    if (len === 0) return;
    state.local.currentTime = 0;
    state.local.currentIndex = state.local.currentIndex < len - 1 ? state.local.currentIndex + 1 : 0;
    state.local.isPlaying = true;
};
const onShuffleToggle = (): void => {
    state.local.shuffle = !state.local.shuffle;
};
const onLoopCycle = (): void => {
    state.local.loop = state.local.loop === 'none' ? 'all' : state.local.loop === 'all' ? 'one' : 'none';
};
const onVolumeChange = (v: number): void => {
    state.local.myVolume = v;
};

// ── レンダリング ────────────────────────────────────
function render(): void {
    const track = state.local.playlist[state.local.currentIndex];
    const ct = estimatedTime();
    const progress = state.local.duration > 0 ? (ct / state.local.duration) * 100 : 0;
    const isLive = track?.mode === 'live';
    const volume = state.local.myVolume;
    const VolumeIcon =
        volume === 0 ? VolumeMuteIcon : volume < 0.3 ? VolumeLowIcon : volume < 0.7 ? VolumeMediumIcon : VolumeHighIcon;
    const LoopIconComp = state.local.loop === 'one' ? RepeatOneIcon : RepeatIcon;
    const isPlaying = state.local.isPlaying;
    const empty = state.local.playlist.length === 0;

    Ubi.ui.render(
        () => (
            <div
                style={{
                    position: 'absolute',
                    inset: '0',
                    background: '#1a1a1a',
                    borderRadius: '12px',
                    padding: '8px 12px',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    fontFamily: 'system-ui, -apple-system, sans-serif',
                    userSelect: 'none',
                    pointerEvents: 'auto',
                }}
            >
                <input
                    type="range"
                    min="0"
                    max={String(state.local.duration > 0 ? Math.floor(state.local.duration) : 100)}
                    step="1"
                    value={String(Math.round(ct))}
                    disabled={state.local.duration <= 0 || isLive}
                    style={{
                        width: '100%',
                        height: '4px',
                        marginBottom: '8px',
                        display: 'block',
                        cursor: state.local.duration <= 0 || isLive ? 'default' : 'pointer',
                        accentColor: '#007aff',
                        appearance: 'none',
                        background: `linear-gradient(to right, #007aff ${progress}%, rgba(255,255,255,0.2) ${progress}%)`,
                        borderRadius: '2px',
                        outline: 'none',
                    }}
                    onUbiInput={(val: unknown) => onSeek(Number.parseFloat(String(val)))}
                />
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
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
                                {fmt(ct)} /{' '}
                                {state.local.duration > 0 ? fmt(state.local.duration) : isLive ? 'LIVE' : '--:--'}
                            </div>
                        </div>
                    </div>

                    {/* 中央: 再生 */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <CtrlBtn disabled={empty} onClick={onPrev}>
                            <SkipPrevIcon size={18} />
                        </CtrlBtn>
                        <button
                            type="button"
                            disabled={empty}
                            style={{
                                background: '#007aff',
                                border: 'none',
                                color: '#fff',
                                cursor: empty ? 'not-allowed' : 'pointer',
                                width: '36px',
                                height: '36px',
                                borderRadius: '50%',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                boxShadow: '0 2px 8px rgba(0,122,255,0.3)',
                                opacity: empty ? '0.5' : '1',
                            }}
                            onUbiClick={onPlayToggle}
                        >
                            {isPlaying ? <PauseIcon size={20} /> : <PlayIcon size={20} />}
                        </button>
                        <CtrlBtn disabled={empty} onClick={onNext}>
                            <SkipNextIcon size={18} />
                        </CtrlBtn>
                    </div>

                    {/* 右: shuffle / loop / volume */}
                    <div
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            flex: '1',
                            justifyContent: 'flex-end',
                        }}
                    >
                        <CtrlBtn active={state.local.shuffle} onClick={onShuffleToggle}>
                            <ShuffleIcon size={16} />
                        </CtrlBtn>
                        <CtrlBtn active={state.local.loop !== 'none'} onClick={onLoopCycle}>
                            <LoopIconComp size={16} />
                        </CtrlBtn>
                        <span style={{ color: 'rgba(255,255,255,0.8)', display: 'flex', alignItems: 'center' }}>
                            <VolumeIcon size={16} />
                        </span>
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
                            onUbiInput={(val: unknown) => onVolumeChange(Number.parseFloat(String(val)))}
                        />
                    </div>
                </div>
            </div>
        ),
        'controls',
    );
}

// ── 共通ボタン ──────────────────────────────────────
function CtrlBtn({
    children,
    onClick,
    disabled = false,
    active = false,
}: {
    children:
        | import('@ubichill/sdk/jsx-runtime').JSX.Element
        | import('@ubichill/sdk/jsx-runtime').JSX.Element[]
        | null;
    onClick: () => void;
    disabled?: boolean;
    active?: boolean;
}): import('@ubichill/sdk/jsx-runtime').JSX.Element {
    return (
        <button
            type="button"
            disabled={disabled}
            style={{
                background: 'transparent',
                border: 'none',
                cursor: disabled ? 'not-allowed' : 'pointer',
                padding: '6px',
                borderRadius: '6px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: '0',
                color: disabled ? 'rgba(255,255,255,0.3)' : active ? '#007aff' : 'rgba(255,255,255,0.8)',
                opacity: disabled ? '0.3' : '1',
            }}
            onUbiClick={onClick}
        >
            {children}
        </button>
    );
}

// ── 進行バー推定の駆動 (clock-only 再描画) ─────────────
// state.persistent の onChange だけでは「秒針が進む」の表現ができないため、
// 1 秒ごとに軽量再描画 (clock estimation のみ) を打つ。
const ClockSystem: System = (_e: Entity[], dt: number) => {
    if (!state.local.isPlaying) return;
    // dt は ms。1 秒蓄積で再描画。
    accumulator.ms += dt;
    if (accumulator.ms >= 1000) {
        accumulator.ms = 0;
        render();
    }
};
const accumulator = { ms: 0 };

Ubi.registerSystem(ClockSystem);

// 初期 1 回レンダー (state は Ubi.state.sync が initialEntities から既に同期反映済み)
state.local.lastSyncedTime = state.local.currentTime;
state.local.lastSyncedAt = Date.now();
render();
