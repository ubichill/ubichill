import type { SharedStateEntry } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import {
    estimateServerNow,
    estimateServerWriteTime,
    type MediaTimelineAction,
    type MediaTimelineValue,
    measureServerClock,
    mediaStateKey,
    parseMediaTimelineValue,
    planMediaTimelineUpdate,
    timelineFromEntry,
    timelinePosition,
} from './mediaTimeline';

const SESSION = 'mod:screen:scope:main';
const T0 = 1_700_000_000_000;

function entry(value: unknown, revision: number, updatedAt = T0, key = mediaStateKey(SESSION)): SharedStateEntry {
    return { key, value, revision, updatedAt, updatedBy: 'alice' };
}

/** plan の結果をサーバーが受け入れたとして、次の entry を作る（サーバーは revision と時刻だけを付ける）。 */
function apply(current: SharedStateEntry | null, action: MediaTimelineAction, serverTime: number): SharedStateEntry {
    const plan = planMediaTimelineUpdate(SESSION, current, action, serverTime);
    if (plan.kind !== 'write') throw new Error(`expected write, got ${JSON.stringify(plan)}`);
    expect(plan.expectedRevision).toBe(current?.revision ?? 0);
    return entry(plan.value, plan.expectedRevision + 1, serverTime);
}

function value(e: SharedStateEntry): MediaTimelineValue {
    const parsed = parseMediaTimelineValue(e.value);
    if (!parsed) throw new Error('invalid value');
    return parsed;
}

describe('planMediaTimelineUpdate: 状態遷移', () => {
    it('load 前の play は拒否する', () => {
        expect(planMediaTimelineUpdate(SESSION, null, { mediaId: 'one', action: 'play' }, T0).kind).toBe('reject');
    });

    it('再生中の位置を書き込み時刻まで進め、速度を引き継ぐ', () => {
        const loaded = apply(null, { mediaId: 'one', action: 'load', duration: 10, playbackRate: 1.5 }, T0);
        expect(value(loaded)).toEqual({
            mediaId: 'one',
            phase: 'paused',
            anchorTime: 0,
            playbackRate: 1.5,
            duration: 10,
        });
        // 停止中は時間が経っても位置は進まない
        const playing = apply(loaded, { mediaId: 'one', action: 'play' }, T0 + 5_000);
        expect(value(playing)).toMatchObject({ phase: 'playing', anchorTime: 0, playbackRate: 1.5 });
        expect(playing.revision).toBe(2);

        const paused = apply(playing, { mediaId: 'one', action: 'pause' }, T0 + 7_000);
        expect(value(paused).anchorTime).toBeCloseTo(3);
        expect(value(paused)).toMatchObject({ phase: 'paused', playbackRate: 1.5 });
    });

    it('長く再生したあとの位置は duration で止まる', () => {
        const playing = apply(
            apply(null, { mediaId: 'one', action: 'load', duration: 10 }, T0),
            { mediaId: 'one', action: 'play' },
            T0,
        );
        const paused = apply(playing, { mediaId: 'one', action: 'pause' }, T0 + 60_000);
        expect(value(paused).anchorTime).toBe(10);
    });

    it('ended は末尾に揃え、duration が無ければその時点の位置で止める', () => {
        const playing = apply(
            apply(null, { mediaId: 'one', action: 'load', duration: 10 }, T0),
            { mediaId: 'one', action: 'play' },
            T0,
        );
        expect(value(apply(playing, { mediaId: 'one', action: 'ended', position: 3 }, T0 + 1_000))).toMatchObject({
            phase: 'ended',
            anchorTime: 10,
        });

        const live = apply(
            apply(null, { mediaId: 'live', action: 'load' }, T0),
            { mediaId: 'live', action: 'play' },
            T0,
        );
        expect(value(apply(live, { mediaId: 'live', action: 'ended' }, T0 + 4_000))).toMatchObject({
            phase: 'ended',
            anchorTime: 4,
        });
    });

    it('seek は位置だけを変え、再生中なら再生を続ける', () => {
        const playing = apply(
            apply(null, { mediaId: 'one', action: 'load', duration: 100 }, T0),
            { mediaId: 'one', action: 'play' },
            T0,
        );
        const sought = apply(playing, { mediaId: 'one', action: 'seek', position: 42 }, T0 + 9_000);
        expect(value(sought)).toMatchObject({ phase: 'playing', anchorTime: 42 });
        // 新しい基準時刻はサーバーが刻む書き込みの時刻
        const timeline = timelineFromEntry(SESSION, sought);
        expect(timeline?.anchorServerTime).toBe(T0 + 9_000);
        expect(timeline && timelinePosition(timeline, T0 + 10_000)).toBeCloseTo(43);
    });

    it('metadata は duration を変え、同じ長さなら書かない', () => {
        const loaded = apply(null, { mediaId: 'one', action: 'load' }, T0);
        const meta = apply(loaded, { mediaId: 'one', action: 'metadata', duration: 20 }, T0);
        expect(value(meta).duration).toBe(20);
        expect(
            planMediaTimelineUpdate(SESSION, meta, { mediaId: 'one', action: 'metadata', duration: 20 }, T0),
        ).toEqual({
            kind: 'unchanged',
        });
        expect(value(apply(meta, { mediaId: 'one', action: 'metadata', duration: null }, T0)).duration).toBeNull();
    });

    it('同じメディアの load は書かず、別のメディアの load は今の revision に対して最初からやり直す', () => {
        const playing = apply(
            apply(null, { mediaId: 'one', action: 'load', duration: 10, playbackRate: 2 }, T0),
            { mediaId: 'one', action: 'play' },
            T0,
        );
        expect(planMediaTimelineUpdate(SESSION, playing, { mediaId: 'one', action: 'load' }, T0 + 1_000)).toEqual({
            kind: 'unchanged',
        });
        const reloaded = apply(playing, { mediaId: 'two', action: 'load' }, T0 + 1_000);
        expect(reloaded.revision).toBe(playing.revision + 1);
        expect(value(reloaded)).toEqual({
            mediaId: 'two',
            phase: 'paused',
            anchorTime: 0,
            playbackRate: 2,
            duration: null,
        });
    });

    it('別のメディアへの操作と不正な操作は拒否する', () => {
        const loaded = apply(null, { mediaId: 'one', action: 'load', duration: 10 }, T0);
        const cases: Record<string, MediaTimelineAction> = {
            'other media': { mediaId: 'two', action: 'play' },
            'negative position': { mediaId: 'one', action: 'seek', position: -1 },
            'NaN position': { mediaId: 'one', action: 'seek', position: Number.NaN },
            'infinite duration': { mediaId: 'one', action: 'metadata', duration: Number.POSITIVE_INFINITY },
            'zero rate': { mediaId: 'one', action: 'play', playbackRate: 0 },
            'too fast': { mediaId: 'one', action: 'play', playbackRate: 5 },
            'string position': { mediaId: 'one', action: 'seek', position: '1' as unknown as number },
            'unknown action': { mediaId: 'one', action: 'rewind' as MediaTimelineAction['action'] },
            'empty media': { mediaId: '', action: 'load' },
            'long media': { mediaId: 'x'.repeat(513), action: 'load' },
        };
        for (const [name, action] of Object.entries(cases)) {
            expect(planMediaTimelineUpdate(SESSION, loaded, action, T0).kind, name).toBe('reject');
        }
    });
});

describe('共有状態に届いた値の検証', () => {
    const valid: MediaTimelineValue = {
        mediaId: 'one',
        phase: 'playing',
        anchorTime: 1,
        playbackRate: 1,
        duration: 10,
    };

    it('他の参加者が書いた壊れた値はタイムラインにしない', () => {
        const broken: unknown[] = [
            null,
            'one',
            [valid],
            { ...valid, mediaId: '' },
            { ...valid, phase: 'rewinding' },
            { ...valid, anchorTime: -1 },
            { ...valid, anchorTime: Number.POSITIVE_INFINITY },
            { ...valid, playbackRate: 0 },
            { ...valid, playbackRate: 100 },
            { ...valid, duration: '10' },
            { ...valid, duration: undefined },
        ];
        for (const v of broken) expect(parseMediaTimelineValue(v), JSON.stringify(v)).toBeNull();
        expect(parseMediaTimelineValue({ ...valid, extra: 'ignored' })).toEqual(valid);
    });

    it('別のキーの entry は使わない', () => {
        expect(timelineFromEntry(SESSION, entry(valid, 1, T0, mediaStateKey('other')))).toBeNull();
        expect(timelineFromEntry(SESSION, entry(valid, 3, T0 + 5))).toEqual({
            sessionId: SESSION,
            ...valid,
            anchorServerTime: T0 + 5,
            revision: 3,
            updatedBy: 'alice',
        });
    });

    it('壊れた値は load で上書きでき、それ以外の操作は拒否する', () => {
        const garbage = entry({ hacked: true }, 7);
        const plan = planMediaTimelineUpdate(SESSION, garbage, { mediaId: 'one', action: 'load' }, T0);
        expect(plan).toMatchObject({ kind: 'write', expectedRevision: 7, value: { mediaId: 'one' } });
        expect(planMediaTimelineUpdate(SESSION, garbage, { mediaId: 'one', action: 'play' }, T0).kind).toBe('reject');
    });
});

describe('timelinePosition', () => {
    const base = { sessionId: SESSION, mediaId: 'one', anchorServerTime: T0, revision: 1, updatedBy: 'a' };

    it('停止中は進まず、再生中は速度に合わせて進む', () => {
        const paused = { ...base, phase: 'paused' as const, anchorTime: 5, playbackRate: 2, duration: 100 };
        expect(timelinePosition(paused, T0 + 10_000)).toBe(5);
        expect(timelinePosition({ ...paused, phase: 'playing' }, T0 + 10_000)).toBe(25);
    });

    it('サーバー時刻の推定が基準時刻より前でも巻き戻さない', () => {
        const playing = { ...base, phase: 'playing' as const, anchorTime: 5, playbackRate: 1, duration: null };
        expect(timelinePosition(playing, T0 - 3_000)).toBe(5);
        expect(timelinePosition(playing, T0 + 1e9)).toBe(5 + 1e6);
    });
});

describe('サーバー時計の推定', () => {
    it('往復の中間をサーバーの応答時刻とみなす', () => {
        // ローカルの時計がサーバーより 5 秒遅れ、往復 200ms
        const clock = measureServerClock(1_000, 1_200, 6_100);
        expect(clock).toEqual({ offsetMs: 5_000, oneWayMs: 100 });
        expect(estimateServerNow(clock, 2_000)).toBe(7_000);
        expect(estimateServerWriteTime(clock, 2_000)).toBe(7_100);
    });

    it('時計のずれがあっても、書き込みの時刻で外挿した位置はサーバーの基準と揃う', () => {
        const clock = measureServerClock(1_000, 1_200, T0 + 100);
        const playing = apply(
            apply(null, { mediaId: 'one', action: 'load', duration: 100 }, T0),
            { mediaId: 'one', action: 'play' },
            T0,
        );
        // ローカルの 4.1 秒（サーバーの T0+3.1 秒）に送った pause は、片道 0.1 秒後に届いて刻まれる
        const localNow = 4_100;
        const plan = planMediaTimelineUpdate(
            SESSION,
            playing,
            { mediaId: 'one', action: 'pause' },
            estimateServerWriteTime(clock, localNow),
        );
        expect(plan.kind === 'write' && plan.value.anchorTime).toBeCloseTo(3.2);
    });
});
