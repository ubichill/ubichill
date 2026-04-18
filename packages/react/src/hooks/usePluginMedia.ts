/**
 * usePluginMedia
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

import type { PluginHostEvent } from '@ubichill/shared';
import Hls from 'hls.js';
import type React from 'react';
import { useEffect, useRef } from 'react';
import type { WorkerPluginDefinition } from '../types';
import type { PluginWorkerHandlers } from '../usePluginWorker';

// ── 内部状態 ──────────────────────────────────────────────────

interface MediaEntry {
    video: HTMLVideoElement;
    hls: Hls | null;
    visible: boolean;
}

// ─────────────────────────────────────────────────────────────

export interface UsePluginMediaResult {
    /** <video> 要素の ref コールバック。JSX の ref prop に直接渡す */
    getVideoRef: (targetId: string) => (el: HTMLVideoElement | null) => void;
    /** usePluginWorker の handlers に spread する */
    mediaHandlers: Pick<
        PluginWorkerHandlers,
        | 'onMediaLoad'
        | 'onMediaPlay'
        | 'onMediaPause'
        | 'onMediaSeek'
        | 'onMediaSetVolume'
        | 'onMediaDestroy'
        | 'onMediaSetVisible'
    >;
    /** targetId → visible のマップ（GenericPluginHost が <video> の display を制御するため） */
    mediaVisibilityRef: React.RefObject<Map<string, boolean>>;
}

export function usePluginMedia(
    _definition: WorkerPluginDefinition,
    sendEventRef: React.RefObject<((event: PluginHostEvent) => void) | null>,
): UsePluginMediaResult {
    const mediaEntriesRef = useRef<Map<string, MediaEntry>>(new Map());
    const mediaVisibilityRef = useRef<Map<string, boolean>>(new Map());
    // 各 targetId のリスナーをまとめて解除できるよう保持
    const listenersRef = useRef<
        Map<string, { timeupdate: () => void; ended: () => void; error: () => void; loadedmetadata: () => void }>
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
                        mediaEntriesRef.current.set(targetId, { video: el, hls: null, visible: false });
                    }
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

    const _attachListeners = (targetId: string, video: HTMLVideoElement): void => {
        // 旧リスナーを先に外す
        const old = listenersRef.current.get(targetId);
        if (old) {
            video.removeEventListener('timeupdate', old.timeupdate);
            video.removeEventListener('ended', old.ended);
            video.removeEventListener('error', old.error);
            video.removeEventListener('loadedmetadata', old.loadedmetadata);
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

        video.addEventListener('timeupdate', timeupdate);
        video.addEventListener('ended', ended);
        video.addEventListener('error', error);
        video.addEventListener('loadedmetadata', loadedmetadata);
        listenersRef.current.set(targetId, { timeupdate, ended, error, loadedmetadata });
    };

    const mediaHandlers: UsePluginMediaResult['mediaHandlers'] = {
        onMediaLoad: (targetId, url, mediaType) => {
            const entry = mediaEntriesRef.current.get(targetId);
            if (!entry) return;
            const { video } = entry;

            // 既存 Hls を破棄
            if (entry.hls) {
                entry.hls.destroy();
                entry.hls = null;
            }

            _attachListeners(targetId, video);

            const useHls =
                mediaType === 'hls' || (mediaType !== 'video' && (url.includes('.m3u8') || url.includes('/live/')));

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
                // Safari ネイティブ HLS
                video.src = url;
            } else {
                video.src = url;
                video.load();
            }
        },

        onMediaPlay: (targetId) => {
            const video = mediaEntriesRef.current.get(targetId)?.video;
            video?.play().catch(() => undefined);
        },

        onMediaPause: (targetId) => {
            mediaEntriesRef.current.get(targetId)?.video.pause();
        },

        onMediaSeek: (targetId, time) => {
            const video = mediaEntriesRef.current.get(targetId)?.video;
            if (video) video.currentTime = time;
        },

        onMediaSetVolume: (targetId, volume) => {
            const video = mediaEntriesRef.current.get(targetId)?.video;
            if (video) video.volume = Math.max(0, Math.min(1, volume));
        },

        onMediaDestroy: (targetId) => {
            const entry = mediaEntriesRef.current.get(targetId);
            if (!entry) return;
            _destroyEntry(entry);
            mediaEntriesRef.current.delete(targetId);
            listenersRef.current.delete(targetId);
        },

        onMediaSetVisible: (targetId, visible) => {
            const entry = mediaEntriesRef.current.get(targetId);
            if (!entry) return;
            entry.visible = visible;
            entry.video.style.display = visible ? 'block' : 'none';
            mediaVisibilityRef.current.set(targetId, visible);
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
