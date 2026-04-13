/**
 * video-player:screen Worker
 *
 * 責務: メディア再生のみ。UI は持たない。
 * 状態は ECS エンティティデータを経由して controls worker と共有する。
 *
 * - controls worker が updateEntity(screenId, {data: patch}) で状態を変更
 * - watchEntityTypes: ['video-player:screen'] で自身のエンティティ変更を検知
 * - 差分を比較してメディア操作を実行する
 */

import type { Entity, System, WorkerEvent } from '@ubichill/sdk';

// ── 型 ──────────────────────────────────────────────

interface Track {
    id: string;
    title: string;
    thumbnail: string;
    duration: number;
    mode: 'live' | 'video';
}

type LoopMode = 'none' | 'playlist' | 'track';

interface ScreenData {
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
}

// ── モジュール状態 ────────────────────────────────────

let state: ScreenData = {
    playlist: [],
    currentIndex: 0,
    isPlaying: false,
    isVisible: false,
    volume: 0,
    loop: 'none',
    shuffle: false,
    currentTime: 0,
    duration: 0,
    apiBase: '',
    seekNonce: 0,
};
let _loaded = false;
let _localTime = 0;
let _localDuration = 0;
let _lastBroadcastAt = 0;
const TARGET = 'main';

// ── ヘルパー ─────────────────────────────────────────

function _loadTrack(autoPlay: boolean): void {
    const track = state.playlist[state.currentIndex];
    if (!track) return;
    const endpoint = track.mode === 'live' ? 'live' : 'video';
    const url = `${state.apiBase}/${endpoint}/${track.id}`;
    Ubi.media.load(url, TARGET, track.mode === 'live' ? 'hls' : 'auto');
    if (autoPlay) Ubi.media.play(TARGET);
}

function _persistPartial(patch: Partial<ScreenData>): void {
    const id = Ubi.entityId;
    if (!id) return;
    void Ubi.world.updateEntity(id, { data: patch as Record<string, unknown> });
}

// ── System（IIFE より前に宣言して TDZ を回避）────────────

const ScreenSystem: System = (_entities: Entity[], _dt: number, events: WorkerEvent[]) => {
    for (const event of events) {
        // controls / 他ユーザーからのエンティティ状態変化
        if (event.type === 'entity:video-player:screen') {
            const entity = event.payload as { data?: Partial<ScreenData> };
            const d = entity.data;
            if (!d) continue;

            const prev = state;
            const next: ScreenData = {
                playlist: d.playlist ?? prev.playlist,
                currentIndex: d.currentIndex ?? prev.currentIndex,
                isPlaying: d.isPlaying ?? prev.isPlaying,
                isVisible: d.isVisible ?? prev.isVisible,
                volume: d.volume ?? prev.volume,
                loop: d.loop ?? prev.loop,
                shuffle: d.shuffle ?? prev.shuffle,
                currentTime: d.currentTime ?? prev.currentTime,
                duration: d.duration ?? prev.duration,
                apiBase: d.apiBase ?? prev.apiBase,
                seekNonce: (d.seekNonce as number) ?? prev.seekNonce,
            };

            const trackChanged = next.currentIndex !== prev.currentIndex;
            const playingChanged = next.isPlaying !== prev.isPlaying;
            const volumeChanged = next.volume !== prev.volume;
            const visibilityChanged = next.isVisible !== prev.isVisible;
            // seekNonce が変わった時だけシーク（shuffle/resize 等の無関係な更新で誤シークしない）
            const seeked = !trackChanged && next.seekNonce !== prev.seekNonce && _loaded;

            state = next;

            if (volumeChanged) Ubi.media.setVolume(next.volume, TARGET);
            if (visibilityChanged) Ubi.media.setVisible(next.isVisible, TARGET);

            if (trackChanged) {
                _loaded = false;
                _localTime = 0;
                _loadTrack(next.isPlaying);
            } else if (playingChanged) {
                if (next.isPlaying) {
                    if (!_loaded) _loadTrack(true);
                    else Ubi.media.play(TARGET);
                } else {
                    Ubi.media.pause(TARGET);
                }
            } else if (seeked) {
                Ubi.media.seek(next.currentTime, TARGET);
                _localTime = next.currentTime;
            }
        }

        // 再生位置更新 + 2秒ごとに全ユーザーへブロードキャスト
        if (event.type === 'media:timeUpdate') {
            const p = event.payload as { targetId: string; currentTime: number; duration: number };
            if (p.targetId !== TARGET) continue;
            _localTime = p.currentTime;
            _localDuration = p.duration;
            const now = Date.now();
            if (state.isPlaying && now - _lastBroadcastAt >= 2000) {
                _lastBroadcastAt = now;
                Ubi.network.broadcast('vp:timeSync', {
                    currentTime: _localTime,
                    currentIndex: state.currentIndex,
                });
            }
        }

        // メタデータ読み込み完了
        if (event.type === 'media:loaded') {
            const p = event.payload as { targetId: string; duration: number };
            if (p.targetId !== TARGET) continue;
            _loaded = true;
            _localDuration = p.duration;
            if (_localDuration > 0) _persistPartial({ duration: _localDuration });
            // 後から参加したユーザーのために保存済み currentTime へシーク
            if (state.currentTime > 3 && state.playlist[state.currentIndex]?.mode !== 'live') {
                Ubi.media.seek(state.currentTime, TARGET);
                _localTime = state.currentTime;
            }
        }

        // 再生終了 → 次トラックへ
        if (event.type === 'media:ended') {
            const p = event.payload as { targetId: string };
            if (p.targetId !== TARGET) continue;

            if (state.loop === 'track') {
                Ubi.media.seek(0, TARGET);
                Ubi.media.play(TARGET);
                continue;
            }

            const nextIdx = state.shuffle ? Math.floor(Math.random() * state.playlist.length) : state.currentIndex + 1;

            if (!state.shuffle && nextIdx >= state.playlist.length) {
                if (state.loop === 'playlist' && state.playlist.length > 0) {
                    state = { ...state, currentIndex: 0, currentTime: 0, isPlaying: true };
                } else {
                    state = { ...state, isPlaying: false };
                }
            } else {
                state = { ...state, currentIndex: nextIdx, currentTime: 0 };
            }

            _loaded = false;
            _localTime = 0;
            if (state.isPlaying) _loadTrack(true);
            _persistPartial({ currentIndex: state.currentIndex, currentTime: 0, isPlaying: state.isPlaying });
        }

        // エラー
        if (event.type === 'media:error') {
            const p = event.payload as { targetId: string; message: string };
            if (p.targetId === TARGET) Ubi.log(`[Screen] media error: ${p.message}`, 'warn');
        }
    }
};

// ── 初期化 ───────────────────────────────────────────

void (async () => {
    const entityId = Ubi.entityId;
    if (!entityId) return;

    try {
        const entity = await Ubi.world.getEntity(entityId);
        if (entity?.data) {
            const d = entity.data as Partial<ScreenData>;
            state = {
                playlist: d.playlist ?? [],
                currentIndex: d.currentIndex ?? 0,
                isPlaying: d.isPlaying ?? false,
                isVisible: d.isVisible ?? false,
                volume: d.volume ?? 0,
                loop: d.loop ?? 'none',
                shuffle: d.shuffle ?? false,
                currentTime: d.currentTime ?? 0,
                duration: d.duration ?? 0,
                apiBase: d.apiBase ?? '',
                seekNonce: (d.seekNonce as number) ?? 0,
            };
        }
    } catch (err) {
        Ubi.log(`[Screen] init error: ${String(err)}`, 'error');
    }

    Ubi.media.setVolume(state.volume, TARGET);
    Ubi.media.setVisible(state.isVisible, TARGET);

    if (state.playlist.length > 0 && state.isPlaying) {
        _loadTrack(true);
    }

    // 3 秒ごとに currentTime を永続化（新規参加者の同期 + controls の進行バー更新用）
    const selfId = entityId;
    setInterval(() => {
        if (state.isPlaying && _loaded) {
            void Ubi.world.updateEntity(selfId, { data: { currentTime: _localTime } });
        }
    }, 3_000);
})();

Ubi.registerSystem(ScreenSystem);
