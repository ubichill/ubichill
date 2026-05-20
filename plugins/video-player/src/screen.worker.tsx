/**
 * video-player:screen Worker — 親 Entity。
 *
 * 責務:
 * - 共有再生状態 (playlist / currentIndex / isPlaying / currentTime / ...) を所有
 * - <video> 要素にメディア URL をロードして再生制御
 * - 16:9 黒背景の UI レイヤ (動画が無いときの placeholder)
 * - 子コンポーネント (controls / playlist / search) は watchScope='parent' で
 *   この screen の state を Ubi.state.persistent 経由で共有する
 */

import type { Entity, System, WorkerEvent } from '@ubichill/sdk';
import type { LoopMode, Track } from './types';

const TARGET = 'main';
const DEFAULT_API_BASE = '/plugins/video-player/api';
const TIME_SYNC_INTERVAL_MS = 2_000;
const TIME_PERSIST_INTERVAL_MS = 3_000;

const state = Ubi.state.define({
    playlist: Ubi.state.persistent([] as Track[]),
    currentIndex: Ubi.state.persistent(0),
    isPlaying: Ubi.state.persistent(false),
    loop: Ubi.state.persistent<LoopMode>('none'),
    shuffle: Ubi.state.persistent(false),
    currentTime: Ubi.state.persistent(0),
    duration: Ubi.state.persistent(0),
    apiBase: Ubi.state.persistent(DEFAULT_API_BASE),
    seekNonce: Ubi.state.persistent(0),
    myVolume: Ubi.state.persistMine(0.7),
    // ローカル
    loaded: false,
    localTime: 0,
    lastBroadcastAt: 0,
    lastPersistedAt: 0,
});

// ── メディア制御 ─────────────────────────────────────
const loadTrack = (autoPlay: boolean): void => {
    const track = state.local.playlist[state.local.currentIndex];
    if (!track) return;
    const base = state.local.apiBase.trim() || DEFAULT_API_BASE;
    const endpoint = track.mode === 'live' ? 'live' : 'video';
    Ubi.media.load(`${base}/${endpoint}/${track.id}`, TARGET, track.mode === 'live' ? 'hls' : 'auto');
    if (autoPlay) Ubi.media.play(TARGET);
};

// ── 共有状態の変化を <video> に反映 ───────────────────
state.onChange('currentIndex', () => {
    state.local.loaded = false;
    state.local.localTime = 0;
    loadTrack(state.local.isPlaying);
});

state.onChange('isPlaying', (playing) => {
    if (playing) {
        if (!state.local.loaded) loadTrack(true);
        else Ubi.media.play(TARGET);
    } else {
        Ubi.media.pause(TARGET);
    }
});

state.onChange('seekNonce', () => {
    if (!state.local.loaded) return;
    Ubi.media.seek(state.local.currentTime, TARGET);
    state.local.localTime = state.local.currentTime;
});

state.onChange('myVolume', (v) => {
    Ubi.media.setVolume(v, TARGET);
});

// 黒背景は host 側の <video> 要素 (mediaTargets) が標準で持つ。
// プラグインから UI 層を被せると video が隠れて再生が見えなくなるので置かない。

// ── ECS System (media イベント処理) ──────────────────
export const ScreenSystem: System = (_entities: Entity[], _dt: number, events: WorkerEvent[]) => {
    for (const event of events) {
        if (event.type === 'media:timeUpdate') {
            const p = event.payload as { targetId: string; currentTime: number; duration: number };
            if (p.targetId !== TARGET) continue;
            state.local.localTime = p.currentTime;
            if (p.duration > 0 && p.duration !== state.local.duration) state.local.duration = p.duration;
            const now = Date.now();
            if (state.local.isPlaying && now - state.local.lastBroadcastAt >= TIME_SYNC_INTERVAL_MS) {
                state.local.lastBroadcastAt = now;
                Ubi.event.broadcast('vp:timeSync', {
                    currentTime: state.local.localTime,
                    currentIndex: state.local.currentIndex,
                });
            }
            // 3 秒ごとに currentTime を永続化 (新規参加者の同期用)
            if (state.local.isPlaying && now - state.local.lastPersistedAt >= TIME_PERSIST_INTERVAL_MS) {
                state.local.lastPersistedAt = now;
                state.local.currentTime = state.local.localTime;
            }
            continue;
        }

        if (event.type === 'media:loaded') {
            const p = event.payload as { targetId: string; duration: number };
            if (p.targetId !== TARGET) continue;
            state.local.loaded = true;
            if (p.duration > 0) state.local.duration = p.duration;
            const track = state.local.playlist[state.local.currentIndex];
            if (state.local.currentTime > 0 && track?.mode !== 'live') {
                Ubi.media.seek(state.local.currentTime, TARGET);
                state.local.localTime = state.local.currentTime;
            }
            if (state.local.isPlaying) Ubi.media.play(TARGET);
            continue;
        }

        if (event.type === 'media:ended') {
            const p = event.payload as { targetId: string };
            if (p.targetId !== TARGET) continue;

            if (state.local.loop === 'one') {
                Ubi.media.seek(0, TARGET);
                Ubi.media.play(TARGET);
                continue;
            }

            const len = state.local.playlist.length;
            if (len === 0) {
                state.local.isPlaying = false;
                continue;
            }
            const nextIdx = state.local.shuffle
                ? Math.floor(Math.random() * len)
                : (state.local.currentIndex + 1) % len;
            const isWrapping = !state.local.shuffle && nextIdx === 0 && state.local.currentIndex === len - 1;
            if (isWrapping && state.local.loop !== 'all') {
                state.local.isPlaying = false;
            } else {
                state.local.currentIndex = nextIdx;
                state.local.currentTime = 0;
            }
        }
    }
};

Ubi.registerSystem(ScreenSystem);

// ── 初期化 ──────────────────────────────────────────
// 動画要素は常時表示 (黒背景の上に重ねる)
Ubi.media.setVisible(true, TARGET);
Ubi.media.setVolume(state.local.myVolume, TARGET);
if (state.local.playlist.length > 0) loadTrack(state.local.isPlaying);
