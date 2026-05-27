/**
 * video-player:controls Worker — 再生制御の中枢。
 *
 * 状態 (entity.data):
 *  - isPlaying / currentTime / duration / seekNonce: 再生位置
 *  - loop / shuffle:                                  繰り返し設定
 *  - apiBase:                                         動画 URL のベース
 *  - myVolume (per-user):                             音量 (個人設定)
 *
 * 受信 (Ubi.event):
 *  - 'vp:track:current' (playlist から)  : 現トラックを cache、変わったら自動 load
 *  - 'vp:media:time'    (screen から)    : currentTime / duration 更新
 *  - 'vp:media:loaded'  (screen から)    : duration 確定 → 必要なら seek + play
 *  - 'vp:media:ended'   (screen から)    : 次トラックを playlist にリクエスト
 *
 * 送信 (Ubi.event):
 *  - 'vp:media:load'    (screen へ)      : URL を渡してロード
 *  - 'vp:media:play' / 'vp:media:pause' (screen へ)
 *  - 'vp:media:seek'    (screen へ)
 *  - 'vp:media:volume'  (screen へ)
 *  - 'vp:track:next' / 'vp:track:prev'  (playlist へ)
 */

import type { Entity, System, WorkerEvent } from '@ubichill/sdk';
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

const DEFAULT_API_BASE = '/plugins/video-player/api';

const state = Ubi.state.define({
    // entity.data 同期
    isPlaying: Ubi.state.sync(false),
    currentTime: Ubi.state.sync(0),
    duration: Ubi.state.sync(0),
    seekNonce: Ubi.state.sync(0),
    loop: Ubi.state.sync<LoopMode>('none'),
    shuffle: Ubi.state.sync(false),
    apiBase: Ubi.state.sync(DEFAULT_API_BASE),
    myVolume: Ubi.state.sync(0.7, { perUser: true }),
    // ローカル
    currentTrack: null as Track | null,
    currentIndex: 0,
    totalTracks: 0,
    lastSyncedTime: 0,
    lastSyncedAt: 0,
});

// ── ヘルパー ────────────────────────────────────────
const fmt = (sec: number): string => {
    if (!Number.isFinite(sec) || sec <= 0) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
};

/**
 * 進行バー表示用の現在時刻の推定値。
 * `lastSyncedTime` を時計で外挿するが、`<video>` 側からの timeupdate が止まったら
 * (= 通信切断 / バッファ枯渇 / メタデータ未確定 など) 一定値以上は伸ばさない。
 * これがないと stall 中も無限にバーが進み、復帰時に巻き戻って見える。
 */
const STALL_THRESHOLD_S = 1.5;
function estimatedTime(): number {
    if (!state.local.isPlaying || state.local.duration <= 0) return state.local.lastSyncedTime;
    const elapsedSec = (Date.now() - state.local.lastSyncedAt) / 1000;
    const capped = Math.min(elapsedSec, STALL_THRESHOLD_S);
    return Math.min(state.local.lastSyncedTime + capped, state.local.duration);
}

function buildTrackUrl(track: Track): string {
    const base = state.local.apiBase.trim() || DEFAULT_API_BASE;
    const endpoint = track.mode === 'live' ? 'live' : 'video';
    return `${base}/${endpoint}/${track.id}`;
}

// ── screen への emit (1 箇所に集約) ───────────────────
const screenTarget = { scope: 'siblings' as const, targetType: 'video-player:screen' };
const playlistTarget = { scope: 'siblings' as const, targetType: 'video-player:playlist' };

function sendLoad(track: Track): void {
    Ubi.event.emit('vp:media:load', { url: buildTrackUrl(track), mode: track.mode }, screenTarget);
}
function sendPlay(): void {
    Ubi.event.emit('vp:media:play', {}, screenTarget);
}
function sendPause(): void {
    Ubi.event.emit('vp:media:pause', {}, screenTarget);
}
function sendSeek(time: number): void {
    Ubi.event.emit('vp:media:seek', { time }, screenTarget);
}
function sendVolume(v: number): void {
    Ubi.event.emit('vp:media:volume', { volume: v }, screenTarget);
}

// ── UI アクション ──────────────────────────────────
const onSeek = (time: number): void => {
    state.local.currentTime = time;
    state.local.seekNonce = Date.now();
    sendSeek(time);
};
const onPlayToggle = (): void => {
    state.local.isPlaying = !state.local.isPlaying;
};
const onPrev = (): void => {
    Ubi.event.emit('vp:track:prev', {}, playlistTarget);
};
const onNext = (): void => {
    Ubi.event.emit('vp:track:next', { loop: state.local.loop, shuffle: state.local.shuffle }, playlistTarget);
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

// ── state 変化 → screen 通知 ───────────────────────
state.onChange('isPlaying', (playing) => {
    if (playing) sendPlay();
    else sendPause();
    state.local.lastSyncedAt = Date.now();
    if (!playing) state.local.lastSyncedTime = estimatedTime();
    render();
});
state.onChange('currentTime', (next) => {
    state.local.lastSyncedTime = next;
    state.local.lastSyncedAt = Date.now();
});
state.onChange('myVolume', (v) => {
    sendVolume(v);
    render();
});
state.onChange('loop', render);
state.onChange('shuffle', render);
state.onChange('duration', render);
state.onChange('seekNonce', () => {
    state.local.lastSyncedTime = state.local.currentTime;
    state.local.lastSyncedAt = Date.now();
    render();
});

// ── レンダリング ──────────────────────────────────
function render(): void {
    const track = state.local.currentTrack;
    const ct = estimatedTime();
    const progress = state.local.duration > 0 ? (ct / state.local.duration) * 100 : 0;
    const isLive = track?.mode === 'live';
    const volume = state.local.myVolume;
    const VolumeIcon =
        volume === 0 ? VolumeMuteIcon : volume < 0.3 ? VolumeLowIcon : volume < 0.7 ? VolumeMediumIcon : VolumeHighIcon;
    const LoopIconComp = state.local.loop === 'one' ? RepeatOneIcon : RepeatIcon;
    const isPlaying = state.local.isPlaying;
    const empty = state.local.totalTracks === 0;

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
                    max={String(state.local.duration > 0 ? state.local.duration : 100)}
                    step="0.1"
                    value={String(ct.toFixed(1))}
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
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: '1', minWidth: '0' }}>
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

// ── 進行バー時計のための tick ────────────────────────
const accumulator = { ms: 0 };
const ClockSystem: System = (_e: Entity[], dt: number, events: WorkerEvent[]) => {
    // emit 受信
    for (const ev of events) {
        if (ev.type === 'vp:track:current') {
            const { track, index, total } = ev.payload as {
                track: Track | null;
                index: number;
                total: number;
            };
            const changed = state.local.currentTrack?.id !== track?.id;
            state.local.currentTrack = track;
            state.local.currentIndex = index;
            state.local.totalTracks = total;
            // トラックが変わったら旧トラックの位置情報をリセット
            // (これがないと、新トラック読み込み中も旧 duration/currentTime でシークバーが描画され、
            //  vp:media:loaded で旧位置に勝手に seek されてしまう)
            if (changed) {
                state.local.currentTime = 0;
                state.local.duration = 0;
                state.local.lastSyncedTime = 0;
                state.local.lastSyncedAt = Date.now();
            }
            render();
            // トラックが変わったら load → (isPlaying なら play)
            if (changed && track) {
                sendLoad(track);
                if (state.local.isPlaying) sendPlay();
            }
        } else if (ev.type === 'vp:media:time') {
            const { currentTime, duration } = ev.payload as { currentTime: number; duration: number };
            state.local.lastSyncedTime = currentTime;
            state.local.lastSyncedAt = Date.now();
            if (duration > 0 && duration !== state.local.duration) state.local.duration = duration;
        } else if (ev.type === 'vp:media:loaded') {
            const { duration } = ev.payload as { duration: number };
            if (duration > 0) state.local.duration = duration;
            // 既存の currentTime がある場合 seek + 必要なら play
            if (state.local.currentTime > 0 && state.local.currentTrack?.mode !== 'live') {
                sendSeek(state.local.currentTime);
            }
            if (state.local.isPlaying) sendPlay();
        } else if (ev.type === 'vp:media:ended') {
            // 次トラックを playlist にリクエスト
            Ubi.event.emit('vp:track:next', { loop: state.local.loop, shuffle: state.local.shuffle }, playlistTarget);
        } else if (ev.type === 'vp:playback:stop') {
            // playlist が末尾到達 (loop='none') を通知してきた → 再生停止
            state.local.isPlaying = false;
        }
    }

    if (!state.local.isPlaying) return;
    // 進行バーが体感ジャギにならない程度の頻度で再描画 (≒ 10fps)。
    // VNode 生成のみ・ネットワーク 0 なので CPU は誤差。
    accumulator.ms += dt;
    if (accumulator.ms >= 100) {
        accumulator.ms = 0;
        render();
    }
};

Ubi.registerSystem(ClockSystem);

// 初期化
state.local.lastSyncedTime = state.local.currentTime;
state.local.lastSyncedAt = Date.now();
render();
// 起動時に screen へ初期音量を通知 (起動順依存吸収)
queueMicrotask(() => sendVolume(state.local.myVolume));
