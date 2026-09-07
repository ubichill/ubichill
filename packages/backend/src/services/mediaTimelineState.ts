import type { MediaTimeline, MediaTimelineIntent, MediaTimelineResult } from '@ubichill/shared';

const timelines = new Map<string, Map<string, MediaTimeline>>();

function instanceTimelines(instanceId: string): Map<string, MediaTimeline> {
    let state = timelines.get(instanceId);
    if (!state) {
        state = new Map();
        timelines.set(instanceId, state);
    }
    return state;
}

function finiteNonNegative(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function validIntent(intent: MediaTimelineIntent): string | null {
    if (!intent || typeof intent !== 'object') return '不正なメディア更新です';
    if (typeof intent.sessionId !== 'string' || intent.sessionId.length < 1 || intent.sessionId.length > 256) {
        return 'sessionId が不正です';
    }
    if (typeof intent.mediaId !== 'string' || intent.mediaId.length < 1 || intent.mediaId.length > 512) {
        return 'mediaId が不正です';
    }
    if (!['load', 'play', 'pause', 'seek', 'ended', 'metadata'].includes(intent.action)) {
        return 'action が不正です';
    }
    if (intent.position !== undefined && !finiteNonNegative(intent.position)) return 'position が不正です';
    if (
        intent.expectedRevision !== undefined &&
        (!Number.isSafeInteger(intent.expectedRevision) || intent.expectedRevision < 0)
    ) {
        return 'expectedRevision が不正です';
    }
    if (intent.duration !== undefined && intent.duration !== null && !finiteNonNegative(intent.duration)) {
        return 'duration が不正です';
    }
    if (
        intent.playbackRate !== undefined &&
        (typeof intent.playbackRate !== 'number' ||
            !Number.isFinite(intent.playbackRate) ||
            intent.playbackRate <= 0 ||
            intent.playbackRate > 4)
    ) {
        return 'playbackRate が不正です';
    }
    return null;
}

export function mediaTimelinePosition(timeline: MediaTimeline, now = Date.now()): number {
    const elapsed = timeline.phase === 'playing' ? Math.max(0, now - timeline.anchorServerTime) / 1000 : 0;
    const position = timeline.anchorTime + elapsed * timeline.playbackRate;
    return timeline.duration === null ? Math.max(0, position) : Math.min(timeline.duration, Math.max(0, position));
}

export function getMediaTimeline(instanceId: string, sessionId: string): MediaTimeline | null {
    return timelines.get(instanceId)?.get(sessionId) ?? null;
}

export function applyMediaTimelineIntent(
    instanceId: string,
    intent: MediaTimelineIntent,
    userId: string,
    now = Date.now(),
): MediaTimelineResult {
    const validationError = validIntent(intent);
    if (validationError) return { success: false, error: validationError, timeline: null, serverTime: now };
    const current = getMediaTimeline(instanceId, intent.sessionId);

    if (intent.expectedRevision !== undefined && current && intent.expectedRevision !== current.revision) {
        return {
            success: false,
            error: 'メディア状態が既に更新されています',
            timeline: current,
            serverTime: now,
        };
    }

    if (intent.action !== 'load' && (!current || current.mediaId !== intent.mediaId)) {
        return { success: false, error: '再生対象がサーバー状態と一致しません', timeline: current, serverTime: now };
    }

    // 同じ source の load は冪等。複数 client が同時に mount しても再生位置を戻さない。
    if (intent.action === 'load' && current?.mediaId === intent.mediaId) {
        return { success: true, timeline: current, serverTime: now };
    }

    const position = current ? mediaTimelinePosition(current, now) : 0;
    const rate = intent.playbackRate ?? current?.playbackRate ?? 1;
    let next: MediaTimeline;

    if (intent.action === 'load') {
        next = {
            sessionId: intent.sessionId,
            mediaId: intent.mediaId,
            phase: 'paused',
            anchorTime: Math.max(0, intent.position ?? 0),
            anchorServerTime: now,
            playbackRate: rate,
            duration: intent.duration ?? null,
            revision: (current?.revision ?? 0) + 1,
            updatedBy: userId,
        };
    } else {
        // load 以外で current が無い場合は上で return 済み。局所変数で型の不変条を固定する。
        const existing = current;
        if (!existing) {
            return { success: false, error: '再生状態がありません', timeline: null, serverTime: now };
        }
        const phase =
            intent.action === 'play'
                ? 'playing'
                : intent.action === 'ended'
                  ? 'ended'
                  : intent.action === 'pause'
                    ? 'paused'
                    : existing.phase;
        const requestedPosition = intent.action === 'seek' ? (intent.position ?? position) : position;
        const duration = intent.action === 'metadata' ? (intent.duration ?? null) : existing.duration;
        next = {
            ...existing,
            phase,
            anchorTime: intent.action === 'ended' && duration !== null ? duration : Math.max(0, requestedPosition),
            anchorServerTime: now,
            playbackRate: rate,
            duration,
            revision: existing.revision + 1,
            updatedBy: userId,
        };
    }

    instanceTimelines(instanceId).set(intent.sessionId, next);
    return { success: true, timeline: next, serverTime: now };
}

export function clearMediaTimelines(instanceId: string): void {
    timelines.delete(instanceId);
}
