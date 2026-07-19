/**
 * useModMedia
 *
 * Worker の media.* コマンド（MEDIA_LOAD / MEDIA_PLAY / … / MEDIA_SET_VISIBLE）を受け取り、
 * ホスト側 HTMLVideoElement + Hls.js で再生を管理する。
 *
 * 設計原則:
 * - Worker はステートレス（Ubi.media.* を呼ぶだけ）
 * - Host がすべての video 要素 / Hls インスタンスを所有
 * - `Ubi.canvas.*` と同じパターン：定義 → ref → handlers の 3 点セット
 *
 * Events sent back to Worker:
 *   EVT_MEDIA_TIME_UPDATE  — timeupdate (約1秒ごと)
 *   EVT_MEDIA_ENDED        — ended
 *   EVT_MEDIA_ERROR        — error
 *   EVT_MEDIA_LOADED       — loadedmetadata (duration が確定)
 */

import type { ModHostEvent } from '@ubichill/shared';
import Hls from 'hls.js';
import type React from 'react';
import { useEffect, useRef } from 'react';
import type { WorkerModDefinition } from '../types';
import type { ModWorkerHandlers } from '../useModWorker';

// ── 内部状態 ──────────────────────────────────────────────────

interface MediaEntry {
    video: HTMLVideoElement;
    hls: Hls | null;
    visible: boolean;
    /** host が意図している再生状態。null=未指定。デバイス操作の差し戻し判定に使う。 */
    intendedPlaying: boolean | null;
    /** デバイス由来（メディアキー/ロック画面/PiP）の操作を許可するか。既定 false=ロック。 */
    deviceControl: boolean;
}

/**
 * <video> 要素がまだ mount されていないタイミングで Worker が media.* を叩いてきたときに
 * ホスト側で保留しておく「最新の意図」。mount されたら一度だけ適用する。
 * mod側に race の存在を意識させないためのバッファ。
 */
interface PendingMedia {
    load?: { url: string; mediaType: 'hls' | 'video' | 'auto' | undefined };
    play?: boolean; // true: play, false: pause
    seek?: number;
    volume?: number;
    visible?: boolean;
    deviceControl?: boolean;
}

// ─────────────────────────────────────────────────────────────

export interface UseModMediaResult {
    /** <video> 要素の ref コールバック。JSX の ref prop に直接渡す */
    getVideoRef: (targetId: string) => (el: HTMLVideoElement | null) => void;
    /** useModWorker の handlers に spread する */
    mediaHandlers: Pick<
        ModWorkerHandlers,
        | 'onMediaLoad'
        | 'onMediaPlay'
        | 'onMediaPause'
        | 'onMediaSeek'
        | 'onMediaSetVolume'
        | 'onMediaDestroy'
        | 'onMediaSetVisible'
        | 'onMediaSetDeviceControl'
    >;
    /** targetId → visible のマップ（GenericModHost が <video> の display を制御するため） */
    mediaVisibilityRef: React.RefObject<Map<string, boolean>>;
}

export function useModMedia(
    _definition: WorkerModDefinition,
    sendEventRef: React.RefObject<((event: ModHostEvent) => void) | null>,
): UseModMediaResult {
    const mediaEntriesRef = useRef<Map<string, MediaEntry>>(new Map());
    const mediaVisibilityRef = useRef<Map<string, boolean>>(new Map());
    // mount 前に来たコマンドを保持するバッファ（targetId → 最後の意図のみ保持）
    const pendingRef = useRef<Map<string, PendingMedia>>(new Map());
    // 各 targetId のリスナーをまとめて解除できるよう保持
    const listenersRef = useRef<
        Map<
            string,
            {
                timeupdate: () => void;
                ended: () => void;
                error: () => void;
                loadedmetadata: () => void;
                play: () => void;
                pause: () => void;
            }
        >
    >(new Map());
    const stableRefCallbacksRef = useRef<Map<string, (el: HTMLVideoElement | null) => void>>(new Map());

    // アンマウント時のクリーンアップ
    useEffect(() => {
        return () => {
            for (const entry of mediaEntriesRef.current.values()) {
                _destroyEntry(entry);
            }
            mediaEntriesRef.current.clear();
            listenersRef.current.clear();
        };
    }, []);

    const getVideoRef = (targetId: string): ((el: HTMLVideoElement | null) => void) => {
        let cb = stableRefCallbacksRef.current.get(targetId);
        if (!cb) {
            cb = (el: HTMLVideoElement | null) => {
                if (el) {
                    // 既存エントリの video を更新（Worker再作成時の再マウント対応）
                    const existing = mediaEntriesRef.current.get(targetId);
                    if (existing) {
                        existing.video = el;
                    } else {
                        mediaEntriesRef.current.set(targetId, {
                            video: el,
                            hls: null,
                            visible: false,
                            intendedPlaying: null,
                            deviceControl: false,
                        });
                    }
                    // 既定はデバイス操作ロック（PiP/リモート再生を無効化）。
                    // 再マウント時は entry に保持済みの設定を維持する。
                    _applyDeviceControl(targetId, mediaEntriesRef.current.get(targetId)?.deviceControl ?? false);
                    // mount 前に溜まったコマンドをここで適用（race 吸収）
                    _drainPending(targetId);
                } else {
                    const entry = mediaEntriesRef.current.get(targetId);
                    if (entry) {
                        _destroyEntry(entry);
                        mediaEntriesRef.current.delete(targetId);
                    }
                    listenersRef.current.delete(targetId);
                }
            };
            stableRefCallbacksRef.current.set(targetId, cb);
        }
        return cb;
    };

    const _getPending = (targetId: string): PendingMedia => {
        let p = pendingRef.current.get(targetId);
        if (!p) {
            p = {};
            pendingRef.current.set(targetId, p);
        }
        return p;
    };

    const _drainPending = (targetId: string): void => {
        const p = pendingRef.current.get(targetId);
        if (!p) return;
        pendingRef.current.delete(targetId);
        if (p.load) _applyLoad(targetId, p.load.url, p.load.mediaType);
        if (p.seek !== undefined) _applySeek(targetId, p.seek);
        if (p.volume !== undefined) _applyVolume(targetId, p.volume);
        if (p.visible !== undefined) _applyVisible(targetId, p.visible);
        if (p.deviceControl !== undefined) _applyDeviceControl(targetId, p.deviceControl);
        if (p.play === true) _applyPlay(targetId);
        else if (p.play === false) _applyPause(targetId);
    };

    const _attachListeners = (targetId: string, video: HTMLVideoElement): void => {
        // 旧リスナーを先に外す
        const old = listenersRef.current.get(targetId);
        if (old) {
            video.removeEventListener('timeupdate', old.timeupdate);
            video.removeEventListener('ended', old.ended);
            video.removeEventListener('error', old.error);
            video.removeEventListener('loadedmetadata', old.loadedmetadata);
            video.removeEventListener('play', old.play);
            video.removeEventListener('pause', old.pause);
        }

        const timeupdate = () => {
            sendEventRef.current?.({
                type: 'EVT_MEDIA_TIME_UPDATE',
                payload: { targetId, currentTime: video.currentTime, duration: video.duration || 0 },
            });
        };
        const ended = () => {
            sendEventRef.current?.({ type: 'EVT_MEDIA_ENDED', payload: { targetId } });
        };
        const error = () => {
            const msg = video.error?.message ?? 'Unknown media error';
            sendEventRef.current?.({ type: 'EVT_MEDIA_ERROR', payload: { targetId, message: msg } });
        };
        const loadedmetadata = () => {
            sendEventRef.current?.({
                type: 'EVT_MEDIA_LOADED',
                payload: { targetId, duration: video.duration || 0 },
            });
        };

        // デバイス操作の差し戻し: deviceControl=false のとき、host の意図と食い違う
        // ネイティブ play/pause（OS メディアキー・ロック画面・PiP 等）を即座に元へ戻す。
        const play = () => {
            const entry = mediaEntriesRef.current.get(targetId);
            if (!entry || entry.deviceControl) return;
            if (entry.intendedPlaying === false) video.pause();
        };
        const pause = () => {
            const entry = mediaEntriesRef.current.get(targetId);
            if (!entry || entry.deviceControl) return;
            // 末尾到達(ended)による pause は差し戻さない（再生し直してしまうため）。
            if (entry.intendedPlaying === true && !video.ended) video.play().catch(() => undefined);
        };

        video.addEventListener('timeupdate', timeupdate);
        video.addEventListener('ended', ended);
        video.addEventListener('error', error);
        video.addEventListener('loadedmetadata', loadedmetadata);
        video.addEventListener('play', play);
        video.addEventListener('pause', pause);
        listenersRef.current.set(targetId, { timeupdate, ended, error, loadedmetadata, play, pause });
    };

    const _applyLoad = (targetId: string, url: string, mediaType: 'hls' | 'video' | 'auto' | undefined): void => {
        const entry = mediaEntriesRef.current.get(targetId);
        if (!entry) return;
        const { video } = entry;
        if (entry.hls) {
            entry.hls.destroy();
            entry.hls = null;
        }
        _attachListeners(targetId, video);
        // Host は特定modの URL 体系を知らない。HLS かどうかは
        //   - modが明示する mediaType==='hls'
        //   - もしくは標準の .m3u8 拡張子
        // だけで判定する（旧 '/live/' のような video-player 固有判定は持たない）。
        const useHls = mediaType === 'hls' || (mediaType !== 'video' && url.includes('.m3u8'));
        if (useHls && Hls.isSupported()) {
            const hls = new Hls({
                enableWorker: true,
                lowLatencyMode: true,
                maxBufferLength: 60,
                maxMaxBufferLength: 120,
                liveSyncDuration: 5,
                liveMaxLatencyDuration: 15,
                backBufferLength: 0,
            });
            hls.loadSource(url);
            hls.attachMedia(video);
            hls.on(Hls.Events.ERROR, (_evt, data) => {
                if (data.fatal) {
                    if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
                        hls.startLoad();
                    } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
                        hls.recoverMediaError();
                    } else {
                        hls.destroy();
                    }
                    sendEventRef.current?.({
                        type: 'EVT_MEDIA_ERROR',
                        payload: { targetId, message: data.details },
                    });
                }
            });
            entry.hls = hls;
        } else if (useHls && (video as HTMLVideoElement).canPlayType('application/vnd.apple.mpegurl')) {
            video.src = url;
        } else {
            video.src = url;
            video.load();
        }
    };

    const _applyPlay = (targetId: string): void => {
        const entry = mediaEntriesRef.current.get(targetId);
        if (!entry) return;
        // 差し戻し判定より先に意図を更新する（自前の play で pause ガードが誤発火しないように）。
        entry.intendedPlaying = true;
        entry.video.play().catch(() => undefined);
    };

    const _applyPause = (targetId: string): void => {
        const entry = mediaEntriesRef.current.get(targetId);
        if (!entry) return;
        entry.intendedPlaying = false;
        entry.video.pause();
    };

    /**
     * デバイス由来の再生操作の許可/禁止を <video> に反映する。
     * 禁止(false)時: PiP/リモート再生を無効化し、OS メディアセッションのハンドラを no-op で奪う。
     * 許可(true)時: それらを解放する。
     */
    const _applyDeviceControl = (targetId: string, enabled: boolean): void => {
        const entry = mediaEntriesRef.current.get(targetId);
        if (!entry) return;
        entry.deviceControl = enabled;
        const { video } = entry;
        video.disablePictureInPicture = !enabled;
        // disableRemotePlayback は型に無いブラウザ拡張属性なので属性で設定する。
        if (enabled) {
            video.removeAttribute('disableremoteplayback');
            video.removeAttribute('controlsList');
        } else {
            video.setAttribute('disableremoteplayback', '');
            video.setAttribute('controlsList', 'nodownload noplaybackrate noremoteplayback');
        }

        const ms = typeof navigator !== 'undefined' ? navigator.mediaSession : undefined;
        if (!ms) return;
        // ロック時は OS 側の再生トグルを無効化（no-op で奪う）。許可時は既定へ戻す。
        const lock = enabled ? null : () => undefined;
        const actions: MediaSessionAction[] = ['play', 'pause', 'stop', 'previoustrack', 'nexttrack'];
        for (const action of actions) {
            try {
                ms.setActionHandler(action, lock);
            } catch {
                // 一部ブラウザは未対応の action で例外を投げる。無視してよい。
            }
        }
    };

    const _applySeek = (targetId: string, time: number): void => {
        const video = mediaEntriesRef.current.get(targetId)?.video;
        if (video) video.currentTime = time;
    };

    const _applyVolume = (targetId: string, volume: number): void => {
        const video = mediaEntriesRef.current.get(targetId)?.video;
        if (video) video.volume = Math.max(0, Math.min(1, volume));
    };

    const _applyVisible = (targetId: string, visible: boolean): void => {
        const entry = mediaEntriesRef.current.get(targetId);
        if (!entry) return;
        entry.visible = visible;
        entry.video.style.display = visible ? 'block' : 'none';
        mediaVisibilityRef.current.set(targetId, visible);
    };

    const mediaHandlers: UseModMediaResult['mediaHandlers'] = {
        onMediaLoad: (targetId, url, mediaType) => {
            if (!mediaEntriesRef.current.has(targetId)) {
                _getPending(targetId).load = { url, mediaType };
                return;
            }
            _applyLoad(targetId, url, mediaType);
        },

        onMediaPlay: (targetId) => {
            if (!mediaEntriesRef.current.has(targetId)) {
                _getPending(targetId).play = true;
                return;
            }
            _applyPlay(targetId);
        },

        onMediaPause: (targetId) => {
            if (!mediaEntriesRef.current.has(targetId)) {
                _getPending(targetId).play = false;
                return;
            }
            _applyPause(targetId);
        },

        onMediaSeek: (targetId, time) => {
            if (!mediaEntriesRef.current.has(targetId)) {
                _getPending(targetId).seek = time;
                return;
            }
            _applySeek(targetId, time);
        },

        onMediaSetVolume: (targetId, volume) => {
            if (!mediaEntriesRef.current.has(targetId)) {
                _getPending(targetId).volume = volume;
                return;
            }
            _applyVolume(targetId, volume);
        },

        onMediaDestroy: (targetId) => {
            pendingRef.current.delete(targetId);
            const entry = mediaEntriesRef.current.get(targetId);
            if (!entry) return;
            _destroyEntry(entry);
            mediaEntriesRef.current.delete(targetId);
            listenersRef.current.delete(targetId);
        },

        onMediaSetVisible: (targetId, visible) => {
            if (!mediaEntriesRef.current.has(targetId)) {
                _getPending(targetId).visible = visible;
                return;
            }
            _applyVisible(targetId, visible);
        },

        onMediaSetDeviceControl: (targetId, enabled) => {
            if (!mediaEntriesRef.current.has(targetId)) {
                _getPending(targetId).deviceControl = enabled;
                return;
            }
            _applyDeviceControl(targetId, enabled);
        },
    };

    return { getVideoRef, mediaHandlers, mediaVisibilityRef };
}

// ─────────────────────────────────────────────────────────────
// ヘルパー
// ─────────────────────────────────────────────────────────────

function _destroyEntry(entry: MediaEntry): void {
    if (entry.hls) {
        entry.hls.destroy();
        entry.hls = null;
    }
    entry.video.pause();
    entry.video.src = '';
    entry.video.load();
}
