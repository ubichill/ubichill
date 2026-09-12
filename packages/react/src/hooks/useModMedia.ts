/** Host-owned media runtime: DOM/HLS lifecycle, state snapshots, and optional shared timeline. */
import { reportDiagnostic } from '@ubichill/sandbox';
import type {
    MediaError,
    MediaLoadOptions,
    MediaMetadata,
    MediaSource,
    MediaState,
    MediaTimeline,
    MediaTimelineIntent,
    MediaTimelineResult,
    ModHostEvent,
} from '@ubichill/shared';
import Hls from 'hls.js';
import type React from 'react';
import { useEffect, useRef } from 'react';
import type { WorkerModDefinition } from '../types';
import type { ModWorkerHandlers } from '../useModWorker';
import { useExternalUrlAuthorization } from './useExternalUrlAuthorization';
import { useSocket } from './useSocket';

type ResolvedLoad = MediaLoadOptions & { targetId: string; loadId: string };

interface MediaEntry {
    video: HTMLVideoElement;
    hls: Hls | null;
    state: MediaState;
    visible: boolean;
    intendedPlaying: boolean | null;
    playbackIntentRevision: number;
    deviceControl: boolean;
    ready: boolean;
    destroyed: boolean;
    cleanupListeners: (() => void) | null;
    serverOffsetMs: number;
    timelineQueue: Promise<void>;
}

interface PendingMedia {
    load?: ResolvedLoad;
    play?: boolean;
    seek?: number;
    volume?: number;
    visible?: boolean;
    deviceControl?: boolean;
}

export interface UseModMediaResult {
    getVideoRef: (targetId: string) => (el: HTMLVideoElement | null) => void;
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
    mediaVisibilityRef: React.RefObject<Map<string, boolean>>;
}

function durationOf(video: HTMLVideoElement): number | null {
    return Number.isFinite(video.duration) && video.duration >= 0 ? video.duration : null;
}

function rangesOf(ranges: TimeRanges): Array<{ start: number; end: number }> {
    const result: Array<{ start: number; end: number }> = [];
    for (let index = 0; index < ranges.length; index++) {
        result.push({ start: ranges.start(index), end: ranges.end(index) });
    }
    return result;
}

function metadataOf(video: HTMLVideoElement): MediaMetadata {
    const duration = durationOf(video);
    return {
        duration,
        videoWidth: video.videoWidth,
        videoHeight: video.videoHeight,
        isLive: duration === null,
        seekable: rangesOf(video.seekable),
    };
}

function initialState(targetId: string): MediaState {
    return {
        targetId,
        loadId: null,
        source: null,
        presentation: 'video',
        sync: 'local',
        status: 'idle',
        currentTime: 0,
        timelineTime: null,
        duration: null,
        playbackRate: 1,
        volume: 1,
        muted: false,
        isLive: false,
        seekable: [],
        buffered: [],
        error: null,
        timeline: null,
        observedAt: Date.now(),
    };
}

export interface TimelinePlaybackCorrection {
    seekTime: number | null;
    playbackRate: number;
}

/** Server の正規時計へ実動画を追従させる。小さな差は速度、大きな差と停止中の差は seek で直す。 */
export function planTimelinePlaybackCorrection(
    phase: MediaTimeline['phase'],
    expectedTime: number,
    currentTime: number,
    canonicalRate: number,
): TimelinePlaybackCorrection {
    const drift = expectedTime - currentTime;
    if (phase !== 'playing') {
        return { seekTime: Math.abs(drift) >= 0.04 ? expectedTime : null, playbackRate: canonicalRate };
    }
    if (Math.abs(drift) >= 0.75) return { seekTime: expectedTime, playbackRate: canonicalRate };
    if (Math.abs(drift) < 0.12) return { seekTime: null, playbackRate: canonicalRate };
    const adjustment = Math.max(-0.05, Math.min(0.05, drift * 0.1));
    return { seekTime: null, playbackRate: canonicalRate * (1 + adjustment) };
}

function domMediaError(video: HTMLVideoElement): MediaError {
    const code = video.error?.code;
    const names: Record<number, string> = {
        1: 'aborted',
        2: 'network',
        3: 'decode',
        4: 'source_not_supported',
    };
    return {
        code: code ? (names[code] ?? `dom_${code}`) : 'unknown',
        message: video.error?.message ?? 'Unknown media error',
        fatal: true,
    };
}

export function useModMedia(
    definition: WorkerModDefinition,
    sendEventRef: React.RefObject<((event: ModHostEvent) => void) | null>,
    syncScopeId: string = definition.id,
): UseModMediaResult {
    const { socket } = useSocket();
    const socketRef = useRef(socket);
    socketRef.current = socket;
    const mediaEntriesRef = useRef<Map<string, MediaEntry>>(new Map());
    const mediaVisibilityRef = useRef<Map<string, boolean>>(new Map());
    const pendingRef = useRef<Map<string, PendingMedia>>(new Map());
    const stableRefCallbacksRef = useRef<Map<string, (el: HTMLVideoElement | null) => void>>(new Map());
    const loadRevisionRef = useRef<Map<string, number>>(new Map());
    const authorizingLoadRef = useRef<Map<string, number>>(new Map());
    const acceptTimelineRef = useRef<(timeline: MediaTimeline) => void>(() => undefined);
    const requestTimelineRef = useRef<(entry: MediaEntry) => void>(() => undefined);
    const emitTimelineTickRef = useRef<() => void>(() => undefined);
    const authorizeUrl = useExternalUrlAuthorization(definition);
    const modId = definition.id.split(':')[0];

    const sessionIdFor = (targetId: string): string => `${definition.id}:${syncScopeId}:${targetId}`;

    const timelineTime = (entry: MediaEntry, now = Date.now()): number | null => {
        const timeline = entry.state.timeline;
        if (!timeline) return null;
        const serverNow = now + entry.serverOffsetMs;
        const elapsed = timeline.phase === 'playing' ? Math.max(0, serverNow - timeline.anchorServerTime) / 1000 : 0;
        const value = timeline.anchorTime + elapsed * timeline.playbackRate;
        return timeline.duration === null ? Math.max(0, value) : Math.min(timeline.duration, Math.max(0, value));
    };

    const emitState = (entry: MediaEntry, patch: Partial<MediaState> = {}): void => {
        if (entry.destroyed) return;
        const { video } = entry;
        const next: MediaState = {
            ...entry.state,
            ...patch,
            currentTime: Number.isFinite(video.currentTime) ? video.currentTime : entry.state.currentTime,
            duration: Object.hasOwn(patch, 'duration')
                ? (patch.duration ?? null)
                : (durationOf(video) ?? entry.state.duration),
            playbackRate: video.playbackRate,
            volume: video.volume,
            muted: video.muted,
            seekable: rangesOf(video.seekable),
            buffered: rangesOf(video.buffered),
            observedAt: Date.now(),
        };
        next.isLive = next.duration === null && video.readyState >= HTMLMediaElement.HAVE_METADATA;
        entry.state = next;
        next.timelineTime = timelineTime(entry, next.observedAt);
        sendEventRef.current?.({ type: 'EVT_MEDIA_STATE', payload: { ...next } });
    };

    const emitError = (entry: MediaEntry, error: MediaError): void => {
        emitState(entry, { status: 'error', error });
        sendEventRef.current?.({
            type: 'EVT_MEDIA_ERROR',
            payload: {
                targetId: entry.state.targetId,
                loadId: entry.state.loadId ?? undefined,
                message: error.message,
                error,
            },
        });
    };

    const syncMediaSessionPlaybackState = (entry: MediaEntry): void => {
        const mediaSession = typeof navigator !== 'undefined' ? navigator.mediaSession : undefined;
        if (!mediaSession || !entry.deviceControl) return;
        mediaSession.playbackState = entry.intendedPlaying === true ? 'playing' : 'paused';
    };

    const applyDeviceControl = (entry: MediaEntry, enabled: boolean): void => {
        entry.deviceControl = enabled;
        syncMediaSessionPlaybackState(entry);
        if (enabled) {
            entry.video.removeAttribute('disableremoteplayback');
            entry.video.removeAttribute('controlsList');
        } else {
            entry.video.setAttribute('disableremoteplayback', '');
            entry.video.setAttribute('controlsList', 'nodownload noplaybackrate noremoteplayback');
        }
        entry.video.disablePictureInPicture = !enabled;
        const mediaSession = typeof navigator !== 'undefined' ? navigator.mediaSession : undefined;
        if (!mediaSession) return;
        const handler = enabled ? null : () => undefined;
        for (const action of ['play', 'pause', 'stop', 'previoustrack', 'nexttrack'] as MediaSessionAction[]) {
            try {
                mediaSession.setActionHandler(action, handler);
            } catch {
                // Browser support differs by action.
            }
        }
    };

    const applyPlay = (entry: MediaEntry): void => {
        const intentRevision = ++entry.playbackIntentRevision;
        entry.intendedPlaying = true;
        syncMediaSessionPlaybackState(entry);
        emitState(entry, {
            status: entry.video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA ? 'playing' : 'buffering',
            error: null,
        });
        void entry.video.play().catch((cause: unknown) => {
            // play() は、その Promise が未解決の間に pause()/load() が呼ばれると reject する。
            // それは現在の再生意図に対する失敗ではないため media:error に昇格しない。
            if (entry.destroyed || entry.intendedPlaying !== true || entry.playbackIntentRevision !== intentRevision) {
                return;
            }
            emitError(entry, {
                code: 'play_rejected',
                message: cause instanceof Error ? cause.message : '再生を開始できません',
                fatal: false,
            });
        });
    };

    const applyPause = (entry: MediaEntry): void => {
        entry.playbackIntentRevision++;
        entry.intendedPlaying = false;
        syncMediaSessionPlaybackState(entry);
        entry.video.pause();
        if (!entry.video.ended) emitState(entry, { status: 'paused' });
    };

    const applySeek = (entry: MediaEntry, time: number): void => {
        if (!Number.isFinite(time) || time < 0 || entry.state.isLive) return;
        entry.video.currentTime = entry.state.duration === null ? time : Math.min(entry.state.duration, time);
    };

    const reconcileTimelinePlayback = (entry: MediaEntry): void => {
        const timeline = entry.state.timeline;
        if (!entry.ready || !timeline || entry.state.isLive) return;
        const expected = timelineTime(entry);
        if (expected === null) return;
        const correction = planTimelinePlaybackCorrection(
            timeline.phase,
            expected,
            entry.video.currentTime,
            timeline.playbackRate,
        );
        if (correction.seekTime !== null) applySeek(entry, correction.seekTime);
        if (Math.abs(entry.video.playbackRate - correction.playbackRate) >= 0.001) {
            entry.video.playbackRate = correction.playbackRate;
        }
    };

    const acceptTimeline = (
        entry: MediaEntry,
        timeline: MediaTimeline,
        serverTime?: number,
        midpoint?: number,
    ): void => {
        if (entry.state.sync !== 'shared' || timeline.sessionId !== sessionIdFor(entry.state.targetId)) return;
        const mediaId = entry.state.source?.id ?? entry.state.source?.url;
        if (!mediaId || timeline.mediaId !== mediaId) return;
        if (serverTime !== undefined && midpoint !== undefined) entry.serverOffsetMs = serverTime - midpoint;
        if (entry.state.timeline && timeline.revision < entry.state.timeline.revision) return;
        entry.state = { ...entry.state, timeline };
        if (entry.ready) {
            if (timeline.phase === 'playing') applyPlay(entry);
            else applyPause(entry);
            reconcileTimelinePlayback(entry);
        }
        emitState(entry, timeline.phase === 'ended' ? { status: 'ended' } : {});
    };

    const publishTimeline = (
        entry: MediaEntry,
        action: MediaTimelineIntent['action'],
        extra: Partial<MediaTimelineIntent> = {},
    ): void => {
        if (entry.state.sync !== 'shared' || !entry.state.source) return;
        const mediaId = entry.state.source.id ?? entry.state.source.url;
        entry.timelineQueue = entry.timelineQueue.then(
            () =>
                new Promise<void>((resolve) => {
                    const activeSocket = socketRef.current;
                    if (!activeSocket?.connected || entry.destroyed) {
                        resolve();
                        return;
                    }
                    const sentAt = Date.now();
                    const intent: MediaTimelineIntent = {
                        sessionId: sessionIdFor(entry.state.targetId),
                        mediaId,
                        action,
                        ...(action !== 'load' && entry.state.timeline
                            ? { expectedRevision: entry.state.timeline.revision }
                            : {}),
                        ...extra,
                    };
                    let settled = false;
                    const timer = setTimeout(() => {
                        if (settled) return;
                        settled = true;
                        resolve();
                    }, 5_000);
                    activeSocket.emit('media:timeline:update', intent, (result: MediaTimelineResult) => {
                        if (settled) return;
                        settled = true;
                        clearTimeout(timer);
                        const receivedAt = Date.now();
                        if (result.timeline)
                            acceptTimeline(entry, result.timeline, result.serverTime, (sentAt + receivedAt) / 2);
                        resolve();
                    });
                }),
        );
    };

    const requestTimeline = (entry: MediaEntry): void => {
        if (entry.state.sync !== 'shared') return;
        entry.timelineQueue = entry.timelineQueue.then(
            () =>
                new Promise<void>((resolve) => {
                    const activeSocket = socketRef.current;
                    if (!activeSocket?.connected || entry.destroyed) {
                        resolve();
                        return;
                    }
                    const sentAt = Date.now();
                    let settled = false;
                    const timer = setTimeout(() => {
                        if (settled) return;
                        settled = true;
                        resolve();
                    }, 5_000);
                    activeSocket.emit(
                        'media:timeline:get',
                        { sessionId: sessionIdFor(entry.state.targetId) },
                        (result: MediaTimelineResult) => {
                            if (settled) return;
                            settled = true;
                            clearTimeout(timer);
                            const receivedAt = Date.now();
                            if (result.timeline)
                                acceptTimeline(entry, result.timeline, result.serverTime, (sentAt + receivedAt) / 2);
                            resolve();
                        },
                    );
                }),
        );
    };
    requestTimelineRef.current = requestTimeline;

    const attachListeners = (entry: MediaEntry): void => {
        entry.cleanupListeners?.();
        const { video } = entry;
        const on = <K extends keyof HTMLMediaElementEventMap>(name: K, listener: () => void): void => {
            video.addEventListener(name, listener);
            cleanups.push(() => video.removeEventListener(name, listener));
        };
        const cleanups: Array<() => void> = [];

        on('loadedmetadata', () => {
            entry.ready = true;
            const metadata = metadataOf(video);
            emitState(entry, { status: 'ready', duration: metadata.duration, isLive: metadata.isLive, error: null });
            sendEventRef.current?.({
                type: 'EVT_MEDIA_LOADED',
                payload: {
                    targetId: entry.state.targetId,
                    loadId: entry.state.loadId ?? undefined,
                    duration: metadata.duration ?? 0,
                    metadata,
                },
            });
            if (entry.state.sync === 'shared') {
                publishTimeline(entry, 'metadata', { duration: metadata.duration });
                if (entry.state.timeline) acceptTimeline(entry, entry.state.timeline);
            }
        });
        on('durationchange', () => emitState(entry));
        on('timeupdate', () => {
            emitState(entry);
            sendEventRef.current?.({
                type: 'EVT_MEDIA_TIME_UPDATE',
                payload: {
                    targetId: entry.state.targetId,
                    loadId: entry.state.loadId ?? undefined,
                    currentTime: video.currentTime,
                    duration: durationOf(video) ?? 0,
                },
            });
        });
        on('playing', () => emitState(entry, { status: 'playing', error: null }));
        on('waiting', () => emitState(entry, { status: 'buffering' }));
        on('stalled', () => emitState(entry, { status: 'buffering' }));
        on('seeking', () => emitState(entry, { status: 'seeking' }));
        on('seeked', () => emitState(entry, { status: video.paused ? 'paused' : 'playing' }));
        on('volumechange', () => emitState(entry));
        on('play', () => {
            if (!entry.deviceControl && entry.intendedPlaying === false) {
                video.pause();
                return;
            }
            if (entry.deviceControl) entry.intendedPlaying = true;
            emitState(entry, { status: 'playing', error: null });
        });
        on('pause', () => {
            if (!entry.deviceControl && entry.intendedPlaying === true && !video.ended) {
                void video.play().catch(() => undefined);
                return;
            }
            if (entry.deviceControl) entry.intendedPlaying = false;
            if (!video.ended) emitState(entry, { status: 'paused' });
        });
        on('ended', () => {
            entry.intendedPlaying = false;
            emitState(entry, { status: 'ended' });
            sendEventRef.current?.({
                type: 'EVT_MEDIA_ENDED',
                payload: { targetId: entry.state.targetId, loadId: entry.state.loadId ?? undefined },
            });
            publishTimeline(entry, 'ended', { position: durationOf(video) ?? video.currentTime });
        });
        on('error', () => emitError(entry, domMediaError(video)));
        entry.cleanupListeners = () => {
            for (const cleanup of cleanups) cleanup();
        };
    };

    const createEntry = (targetId: string, video: HTMLVideoElement): MediaEntry => {
        const entry: MediaEntry = {
            video,
            hls: null,
            state: initialState(targetId),
            visible: false,
            intendedPlaying: null,
            playbackIntentRevision: 0,
            deviceControl: false,
            ready: false,
            destroyed: false,
            cleanupListeners: null,
            serverOffsetMs: 0,
            timelineQueue: Promise.resolve(),
        };
        attachListeners(entry);
        applyDeviceControl(entry, false);
        return entry;
    };

    const applyLoad = (entry: MediaEntry, request: ResolvedLoad): void => {
        entry.ready = false;
        entry.playbackIntentRevision++;
        entry.intendedPlaying = null;
        if (entry.hls) {
            entry.hls.destroy();
            entry.hls = null;
        }
        entry.video.pause();
        entry.video.removeAttribute('src');
        entry.video.load();
        const source: MediaSource = { ...request.source };
        entry.state = {
            ...initialState(request.targetId),
            loadId: request.loadId,
            source,
            presentation: request.presentation ?? 'video',
            sync: request.sync ?? 'local',
            status: 'loading',
            volume: entry.video.volume,
            muted: entry.video.muted,
        };
        applyDeviceControl(entry, request.deviceControl ?? entry.state.presentation === 'audio');
        emitState(entry, { status: 'loading' });

        const useHls = source.type === 'hls' || (source.type !== 'file' && source.url.includes('.m3u8'));
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
            const loadId = request.loadId;
            hls.on(Hls.Events.ERROR, (_event, data) => {
                if (!data.fatal || entry.state.loadId !== loadId) return;
                if (data.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
                else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
                else hls.destroy();
                emitError(entry, { code: `hls_${data.type}_${data.details}`, message: data.details, fatal: true });
            });
            hls.loadSource(source.url);
            hls.attachMedia(entry.video);
            entry.hls = hls;
        } else {
            entry.video.src = source.url;
            entry.video.load();
        }
        // 遅参加 client は Server snapshot を先に受け、その後 idempotent load で未作成時だけ初期化する。
        requestTimeline(entry);
        publishTimeline(entry, 'load');
    };

    const getPending = (targetId: string): PendingMedia => {
        let pending = pendingRef.current.get(targetId);
        if (!pending) {
            pending = {};
            pendingRef.current.set(targetId, pending);
        }
        return pending;
    };

    const drainPending = (targetId: string): void => {
        const pending = pendingRef.current.get(targetId);
        const entry = mediaEntriesRef.current.get(targetId);
        if (!pending || !entry) return;
        pendingRef.current.delete(targetId);
        if (pending.load) applyLoad(entry, pending.load);
        if (pending.seek !== undefined) applySeek(entry, pending.seek);
        if (pending.volume !== undefined) {
            entry.video.volume = Math.max(0, Math.min(1, pending.volume));
        }
        if (pending.visible !== undefined) {
            entry.visible = pending.visible;
            entry.video.style.display = pending.visible ? 'block' : 'none';
            mediaVisibilityRef.current.set(targetId, pending.visible);
        }
        if (pending.deviceControl !== undefined) applyDeviceControl(entry, pending.deviceControl);
        if (pending.play === true) applyPlay(entry);
        else if (pending.play === false) applyPause(entry);
    };

    const destroyEntry = (entry: MediaEntry): void => {
        entry.destroyed = true;
        entry.playbackIntentRevision++;
        entry.cleanupListeners?.();
        entry.cleanupListeners = null;
        entry.hls?.destroy();
        entry.hls = null;
        entry.video.pause();
        entry.video.removeAttribute('src');
        entry.video.load();
    };

    acceptTimelineRef.current = (timeline) => {
        for (const entry of mediaEntriesRef.current.values()) acceptTimeline(entry, timeline);
    };
    emitTimelineTickRef.current = () => {
        for (const entry of mediaEntriesRef.current.values()) {
            if (entry.state.timeline?.phase === 'playing') {
                reconcileTimelinePlayback(entry);
                emitState(entry);
            }
        }
    };

    const getVideoRef = (targetId: string): ((el: HTMLVideoElement | null) => void) => {
        let callback = stableRefCallbacksRef.current.get(targetId);
        if (!callback) {
            callback = (element) => {
                const existing = mediaEntriesRef.current.get(targetId);
                if (element) {
                    if (existing) destroyEntry(existing);
                    const entry = createEntry(targetId, element);
                    mediaEntriesRef.current.set(targetId, entry);
                    // getState() が load 前から一貫して使えるよう、mount 時に idle snapshot を先行通知する。
                    emitState(entry);
                    drainPending(targetId);
                } else if (existing) {
                    destroyEntry(existing);
                    mediaEntriesRef.current.delete(targetId);
                }
            };
            stableRefCallbacksRef.current.set(targetId, callback);
        }
        return callback;
    };

    useEffect(() => {
        if (!socket) return;
        const onTimeline = (timeline: MediaTimeline): void => acceptTimelineRef.current(timeline);
        const refreshTimelines = (): void => {
            for (const entry of mediaEntriesRef.current.values()) requestTimelineRef.current(entry);
        };
        socket.on('media:timeline', onTimeline);
        socket.on('connect', refreshTimelines);
        if (socket.connected) refreshTimelines();
        return () => {
            socket.off('media:timeline', onTimeline);
            socket.off('connect', refreshTimelines);
        };
    }, [socket]);

    useEffect(() => {
        const timer = setInterval(() => emitTimelineTickRef.current(), 250);
        return () => clearInterval(timer);
    }, []);

    // destroyEntry は MediaEntry 以外の render 値を参照しない。unmount 時のみ破棄する。
    // biome-ignore lint/correctness/useExhaustiveDependencies: cleanup must not run on ordinary rerenders
    useEffect(
        () => () => {
            for (const entry of mediaEntriesRef.current.values()) destroyEntry(entry);
            mediaEntriesRef.current.clear();
        },
        [],
    );

    const mediaHandlers: UseModMediaResult['mediaHandlers'] = {
        onMediaLoad: async (targetId, url, mediaType, kind, options) => {
            const revision = (loadRevisionRef.current.get(targetId) ?? 0) + 1;
            loadRevisionRef.current.set(targetId, revision);
            authorizingLoadRef.current.set(targetId, revision);
            const request: ResolvedLoad = options
                ? { ...options, targetId }
                : {
                      source: { url, type: mediaType === 'video' ? 'file' : mediaType },
                      targetId,
                      presentation: kind ?? 'video',
                      sync: 'local',
                      loadId: `legacy_${targetId}_${revision}`,
                  };
            const access = await authorizeUrl(request.source.url);
            if (loadRevisionRef.current.get(targetId) !== revision) return;
            authorizingLoadRef.current.delete(targetId);
            if (!access.allowed) {
                pendingRef.current.delete(targetId);
                const entry = mediaEntriesRef.current.get(targetId);
                if (entry) {
                    entry.state = {
                        ...entry.state,
                        loadId: request.loadId,
                        source: request.source,
                        presentation: request.presentation ?? 'video',
                        sync: request.sync ?? 'local',
                    };
                    emitError(entry, { code: access.code, message: access.message, fatal: true });
                }
                reportDiagnostic({
                    level: 'warn',
                    modId,
                    code: access.code,
                    message: `メディアを読み込めません: ${access.message}`,
                    ...(access.domain ? { retry: { modId, domain: access.domain } } : {}),
                });
                return;
            }
            getPending(targetId).load = { ...request, source: { ...request.source, url: access.url } };
            if (mediaEntriesRef.current.has(targetId)) drainPending(targetId);
        },
        onMediaPlay: (targetId) => {
            const entry = mediaEntriesRef.current.get(targetId);
            if (authorizingLoadRef.current.has(targetId) || !entry) {
                getPending(targetId).play = true;
                return;
            }
            applyPlay(entry);
            publishTimeline(entry, 'play');
        },
        onMediaPause: (targetId) => {
            const entry = mediaEntriesRef.current.get(targetId);
            if (authorizingLoadRef.current.has(targetId) || !entry) {
                getPending(targetId).play = false;
                return;
            }
            applyPause(entry);
            publishTimeline(entry, 'pause');
        },
        onMediaSeek: (targetId, time) => {
            const entry = mediaEntriesRef.current.get(targetId);
            if (authorizingLoadRef.current.has(targetId) || !entry) {
                getPending(targetId).seek = time;
                return;
            }
            applySeek(entry, time);
            publishTimeline(entry, 'seek', { position: time });
        },
        onMediaSetVolume: (targetId, volume) => {
            const entry = mediaEntriesRef.current.get(targetId);
            if (authorizingLoadRef.current.has(targetId) || !entry) {
                getPending(targetId).volume = volume;
                return;
            }
            entry.video.volume = Math.max(0, Math.min(1, volume));
        },
        onMediaDestroy: (targetId) => {
            loadRevisionRef.current.set(targetId, (loadRevisionRef.current.get(targetId) ?? 0) + 1);
            authorizingLoadRef.current.delete(targetId);
            pendingRef.current.delete(targetId);
            const entry = mediaEntriesRef.current.get(targetId);
            if (!entry) return;
            emitState(entry, { status: 'idle', source: null, loadId: null, timeline: null, timelineTime: null });
            destroyEntry(entry);
            mediaEntriesRef.current.delete(targetId);
        },
        onMediaSetVisible: (targetId, visible) => {
            const entry = mediaEntriesRef.current.get(targetId);
            if (authorizingLoadRef.current.has(targetId) || !entry) {
                getPending(targetId).visible = visible;
                return;
            }
            entry.visible = visible;
            entry.video.style.display = visible ? 'block' : 'none';
            mediaVisibilityRef.current.set(targetId, visible);
        },
        onMediaSetDeviceControl: (targetId, enabled) => {
            const entry = mediaEntriesRef.current.get(targetId);
            if (authorizingLoadRef.current.has(targetId) || !entry) {
                getPending(targetId).deviceControl = enabled;
                return;
            }
            applyDeviceControl(entry, enabled);
        },
    };

    return { getVideoRef, mediaHandlers, mediaVisibilityRef };
}
