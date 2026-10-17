/**
 * 共有メディアの再生タイムラインの意味（状態遷移・位置の計算）。
 * インスタンスサーバーは値を解釈しない共有状態として revision と書き込み時刻（updatedAt）だけを付けるので、
 * 「updatedAt＝再生の基準時刻」として MediaTimeline を組み立てる。
 */
import type { MediaTimeline, MediaTimelineIntent, MediaTimelinePhase, SharedStateEntry } from '@ubichill/shared';

/** 共有状態に置く値。revision・基準時刻・更新者は共有状態の entry が持つ。 */
export interface MediaTimelineValue {
    mediaId: string;
    phase: MediaTimelinePhase;
    anchorTime: number;
    playbackRate: number;
    duration: number | null;
}

export type MediaTimelineAction = Omit<MediaTimelineIntent, 'sessionId' | 'expectedRevision'>;

export type MediaTimelinePlan =
    | { kind: 'write'; value: MediaTimelineValue; expectedRevision: number }
    /** 書く必要が無い（同じメディアの load・同じ長さの metadata）。 */
    | { kind: 'unchanged' }
    | { kind: 'reject'; reason: string };

/** サーバー時計の推定。offsetMs はサーバー時刻 − ローカル時刻、oneWayMs は片道の遅延。 */
export interface ServerClock {
    offsetMs: number;
    oneWayMs: number;
}

const MAX_MEDIA_ID_LENGTH = 512;
const MAX_PLAYBACK_RATE = 4;
const PHASES: ReadonlySet<string> = new Set<MediaTimelinePhase>(['paused', 'playing', 'ended']);
const ACTIONS: ReadonlySet<string> = new Set<MediaTimelineAction['action']>([
    'load',
    'play',
    'pause',
    'seek',
    'ended',
    'metadata',
]);

export const INITIAL_SERVER_CLOCK: ServerClock = { offsetMs: 0, oneWayMs: 0 };

export const mediaStateKey = (sessionId: string): string => `media:${sessionId}`;

const isPosition = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0;
const isRate = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= MAX_PLAYBACK_RATE;
const isMediaId = (value: unknown): value is string =>
    typeof value === 'string' && value.length > 0 && value.length <= MAX_MEDIA_ID_LENGTH;

/** 共有状態は部屋の誰でも書けるので、届いた値は形を確かめてから使う。 */
export function parseMediaTimelineValue(value: unknown): MediaTimelineValue | null {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    const v = value as Record<string, unknown>;
    if (!isMediaId(v.mediaId) || typeof v.phase !== 'string' || !PHASES.has(v.phase)) return null;
    if (!isPosition(v.anchorTime) || !isRate(v.playbackRate)) return null;
    if (v.duration !== null && !isPosition(v.duration)) return null;
    return {
        mediaId: v.mediaId,
        phase: v.phase as MediaTimelinePhase,
        anchorTime: v.anchorTime,
        playbackRate: v.playbackRate,
        duration: v.duration as number | null,
    };
}

export function timelineFromEntry(sessionId: string, entry: SharedStateEntry | null): MediaTimeline | null {
    if (!entry || entry.key !== mediaStateKey(sessionId)) return null;
    const value = parseMediaTimelineValue(entry.value);
    if (!value) return null;
    return {
        sessionId,
        ...value,
        anchorServerTime: entry.updatedAt,
        revision: entry.revision,
        updatedBy: entry.updatedBy,
    };
}

/** serverNow 時点の正規の再生位置。再生中だけ基準時刻から進め、0〜duration に収める。 */
export function timelinePosition(timeline: MediaTimeline, serverNow: number): number {
    const elapsed = timeline.phase === 'playing' ? Math.max(0, serverNow - timeline.anchorServerTime) / 1000 : 0;
    const value = timeline.anchorTime + elapsed * timeline.playbackRate;
    return timeline.duration === null ? Math.max(0, value) : Math.min(timeline.duration, Math.max(0, value));
}

function validAction(action: MediaTimelineAction): boolean {
    if (!isMediaId(action.mediaId) || !ACTIONS.has(action.action)) return false;
    if (action.position !== undefined && !isPosition(action.position)) return false;
    if (action.duration !== undefined && action.duration !== null && !isPosition(action.duration)) return false;
    return action.playbackRate === undefined || isRate(action.playbackRate);
}

/**
 * 今の共有状態と操作から、次に書く値を決める。
 * サーバーは書き込みの時刻を新しい基準時刻にするので、再生中の位置は writeServerTime（書き込みがサーバーに
 * 届く時刻の推定）まで進めて新しい anchorTime にする。
 */
export function planMediaTimelineUpdate(
    sessionId: string,
    entry: SharedStateEntry | null,
    action: MediaTimelineAction,
    writeServerTime: number,
): MediaTimelinePlan {
    if (!validAction(action)) return { kind: 'reject', reason: '不正なメディア更新です' };
    const current = timelineFromEntry(sessionId, entry);
    const expectedRevision = entry?.revision ?? 0;
    if (action.action === 'load') {
        if (current?.mediaId === action.mediaId) return { kind: 'unchanged' };
        return {
            kind: 'write',
            expectedRevision,
            value: {
                mediaId: action.mediaId,
                phase: 'paused',
                anchorTime: action.position ?? 0,
                playbackRate: action.playbackRate ?? current?.playbackRate ?? 1,
                duration: action.duration ?? null,
            },
        };
    }
    if (!current || current.mediaId !== action.mediaId) return { kind: 'reject', reason: '再生対象が一致しません' };
    const duration = action.action === 'metadata' ? (action.duration ?? null) : current.duration;
    if (action.action === 'metadata' && duration === current.duration) return { kind: 'unchanged' };
    const position = timelinePosition(current, writeServerTime);
    const phase: MediaTimelinePhase =
        action.action === 'play'
            ? 'playing'
            : action.action === 'pause'
              ? 'paused'
              : action.action === 'ended'
                ? 'ended'
                : current.phase;
    const anchorTime =
        action.action === 'ended'
            ? (duration ?? position)
            : action.action === 'seek'
              ? (action.position ?? position)
              : position;
    return {
        kind: 'write',
        expectedRevision,
        value: {
            mediaId: current.mediaId,
            phase,
            anchorTime,
            playbackRate: action.playbackRate ?? current.playbackRate,
            duration,
        },
    };
}

/** 往復の中間でサーバーが応答したとみなして時計のずれを測る。 */
export function measureServerClock(sentAt: number, receivedAt: number, serverTime: number): ServerClock {
    return { offsetMs: serverTime - (sentAt + receivedAt) / 2, oneWayMs: Math.max(0, (receivedAt - sentAt) / 2) };
}

export const estimateServerNow = (clock: ServerClock, localNow: number): number => localNow + clock.offsetMs;

/** 今送った書き込みがサーバーに届く（updatedAt が刻まれる）時刻の推定。 */
export const estimateServerWriteTime = (clock: ServerClock, localNow: number): number =>
    localNow + clock.offsetMs + clock.oneWayMs;
