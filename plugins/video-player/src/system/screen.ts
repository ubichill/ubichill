/**
 * video-player:screen System レイヤー。
 *
 * 責務:
 * - メディア再生のみ。UI は持たない。
 * - 共有状態は Ubi.state.persistent / persistMine の宣言だけで自動的に entity.data と同期される。
 * - Worker 起動時点のエンティティ状態は SDK が state.local に同期反映してくれるので、
 *   「保険の再試行」や「mount race 対策の再送」のようなコードは不要。
 */

import type { Entity, System, WorkerEvent } from '@ubichill/sdk';
import type { LoopMode, Track } from '../types';

const TARGET = 'main';
const DEFAULT_API_BASE = '/plugins/video-player/api';

const state = Ubi.state.define({
    // 共有フィールド (entity.data に保存される)
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
    // 音量はユーザーごと (entity.data[`myVolume:<userId>`])
    myVolume: Ubi.state.persistMine(0.7),
    // ローカル専用
    loaded: false,
    localTime: 0,
    localDuration: 0,
    lastBroadcastAt: 0,
});

// ── ヘルパー ─────────────────────────────────────────

function _loadTrack(autoPlay: boolean): void {
    const track = state.local.playlist[state.local.currentIndex];
    if (!track) return;
    const apiBase = state.local.apiBase.trim() || DEFAULT_API_BASE;
    const endpoint = track.mode === 'live' ? 'live' : 'video';
    const url = `${apiBase}/${endpoint}/${track.id}`;
    Ubi.media.load(url, TARGET, track.mode === 'live' ? 'hls' : 'auto');
    if (autoPlay) Ubi.media.play(TARGET);
}

// ── onChange リスナー (entity.data 同期で値が変わったときに駆動) ──

state.onChange('currentIndex', () => {
    state.local.loaded = false;
    state.local.localTime = 0;
    _loadTrack(state.local.isPlaying);
});

state.onChange('isPlaying', (playing) => {
    if (playing) {
        if (!state.local.loaded) _loadTrack(true);
        else Ubi.media.play(TARGET);
    } else {
        Ubi.media.pause(TARGET);
    }
});

state.onChange('isVisible', (visible) => {
    Ubi.media.setVisible(visible, TARGET);
});

state.onChange('seekNonce', () => {
    if (!state.local.loaded) return;
    Ubi.media.seek(state.local.currentTime, TARGET);
    state.local.localTime = state.local.currentTime;
});

state.onChange('myVolume', (v) => {
    Ubi.media.setVolume(v, TARGET);
});

// ── ECS System ───────────────────────────────────────

export const ScreenSystem: System = (_entities: Entity[], _dt: number, events: WorkerEvent[]) => {
    for (const event of events) {
        if (event.type === 'media:timeUpdate') {
            const p = event.payload as { targetId: string; currentTime: number; duration: number };
            if (p.targetId !== TARGET) continue;
            state.local.localTime = p.currentTime;
            state.local.localDuration = p.duration;
            const now = Date.now();
            if (state.local.isPlaying && now - state.local.lastBroadcastAt >= 2000) {
                state.local.lastBroadcastAt = now;
                Ubi.network.broadcast('vp:timeSync', {
                    currentTime: state.local.localTime,
                    currentIndex: state.local.currentIndex,
                });
            }
            continue;
        }

        if (event.type === 'media:loaded') {
            const p = event.payload as { targetId: string; duration: number };
            if (p.targetId !== TARGET) continue;
            state.local.loaded = true;
            state.local.localDuration = p.duration;
            if (state.local.localDuration > 0) state.local.duration = state.local.localDuration;
            continue;
        }

        if (event.type === 'media:ended') {
            const p = event.payload as { targetId: string };
            if (p.targetId !== TARGET) continue;

            if (state.local.loop === 'track') {
                Ubi.media.seek(0, TARGET);
                Ubi.media.play(TARGET);
                continue;
            }

            const nextIdx = state.local.shuffle
                ? Math.floor(Math.random() * state.local.playlist.length)
                : state.local.currentIndex + 1;

            if (!state.local.shuffle && nextIdx >= state.local.playlist.length) {
                if (state.local.loop === 'playlist' && state.local.playlist.length > 0) {
                    state.local.currentIndex = 0;
                    state.local.currentTime = 0;
                    state.local.isPlaying = true;
                } else {
                    state.local.isPlaying = false;
                }
            } else {
                state.local.currentIndex = nextIdx;
                state.local.currentTime = 0;
            }
            continue;
        }

        if (event.type === 'media:error') {
            const p = event.payload as { targetId: string; message: string };
            if (p.targetId === TARGET) Ubi.log(`[Screen] media error: ${p.message}`, 'warn');
        }
    }
};

// ── 初期化 ───────────────────────────────────────────

export function initScreen(): void {
    state.local.apiBase = state.local.apiBase.trim() || DEFAULT_API_BASE;
    // 初期状態で既にトラック + 再生中なら、ここでロード（onChange は初期値では発火しない）
    if (state.local.playlist.length > 0 && state.local.isPlaying) {
        _loadTrack(true);
    } else if (state.local.playlist.length > 0) {
        // 一時停止中なら先に音だけロードしておく（初回 play 時の遅延を避ける）
        _loadTrack(false);
    }
    Ubi.media.setVisible(state.local.isVisible, TARGET);
    Ubi.media.setVolume(state.local.myVolume, TARGET);

    // 3 秒ごとに currentTime を永続化 (新規参加者の同期 + controls の進行バー更新用)
    setInterval(() => {
        if (state.local.isPlaying && state.local.loaded) {
            state.local.currentTime = state.local.localTime;
        }
    }, 3_000);
}
