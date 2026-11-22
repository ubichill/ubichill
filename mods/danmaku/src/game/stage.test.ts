import { describe, expect, it } from 'vitest';
import { ENTRY_SECONDS, EXIT_SECONDS, enemySpecOf } from './enemy';
import {
    CLEAR_DELAY_MS,
    clearCountdown,
    clearDelayPassed,
    nextRoundStart,
    playingSeconds,
    readClock,
    stageSeconds,
    stageStatus,
    startsOnBoard,
} from './stage';

const enemy = (id: string, data: Record<string, unknown>) =>
    enemySpecOf({ id, transform: { x: 100, y: 100, w: 40, h: 40 }, data });

describe('readClock・stageSeconds', () => {
    it('壊れた値・負の値は「始まっていない」にする', () => {
        expect(readClock('3', -5)).toEqual({ round: 0, startedAt: 0 });
        expect(readClock(2.7, Number.NaN)).toEqual({ round: 2, startedAt: 0 });
        expect(stageSeconds(readClock(1, 0), 5000)).toBeNull();
    });

    it('始まりが未来（ほかの人の時計が進んでいる）なら負の秒になり、敵はまだ出ない', () => {
        expect(stageSeconds({ round: 1, startedAt: 10_000 }, 9_000)).toBe(-1);
        expect(stageStatus({ round: 1, startedAt: 10_000 }, 9_000, [enemy('a', {})], {}).kind).toBe('running');
    });
});

describe('stageStatus', () => {
    const clock = { round: 1, startedAt: 1_000 };
    const at = (seconds: number) => 1_000 + seconds * 1000;

    it('始まっていない・敵がいないときは何もしない', () => {
        expect(stageStatus({ round: 0, startedAt: 0 }, 5_000, [enemy('a', {})], {}).kind).toBe('idle');
        expect(stageStatus(clock, at(10), [], {}).kind).toBe('idle');
    });

    it('全部倒したらクリア', () => {
        const enemies = [enemy('a', { hp: 3 }), enemy('b', { hp: 1 })];
        expect(stageStatus(clock, at(5), enemies, { a: 3 })).toMatchObject({ kind: 'running', defeated: 1, total: 2 });
        expect(stageStatus(clock, at(5), enemies, { a: 3, b: 5 })).toMatchObject({ kind: 'cleared', defeated: 2 });
    });

    it('倒していなくても、全員が去ったらラウンドは終わる', () => {
        const enemies = [enemy('a', { leaveAt: 10 }), enemy('b', { hp: 1, leaveAt: 20 })];
        expect(stageStatus(clock, at(20 + EXIT_SECONDS - 0.01), enemies, {}).kind).toBe('running');
        expect(stageStatus(clock, at(20 + EXIT_SECONDS), enemies, {})).toMatchObject({ kind: 'cleared', defeated: 0 });
        expect(stageStatus(clock, at(5), enemies, { b: 1 }).kind).toBe('running');
        expect(stageStatus(clock, at(15), enemies, { b: 1 }).kind).toBe('cleared');
    });

    it('居続ける敵を倒さない限りラウンドは終わらない', () => {
        expect(stageStatus(clock, at(1e6), [enemy('boss', { appearAt: 1 })], {}).kind).toBe('running');
    });

    it('まだ現れていない敵がいる間は、ほかを全部倒してもクリアにしない', () => {
        const enemies = [enemy('a', { hp: 1 }), enemy('late', { appearAt: 60 })];
        expect(stageStatus(clock, at(ENTRY_SECONDS + 1), enemies, { a: 1 }).kind).toBe('running');
    });
});

describe('playingSeconds', () => {
    const clock = { round: 1, startedAt: 1_000 };
    const leaving = enemySpecOf({ id: 'a', transform: { x: 0, y: 0, w: 40, h: 40 }, data: { leaveAt: 10 } });

    it('ラウンドの間は経過秒、終わったら（残った弾も消すため）null', () => {
        expect(playingSeconds(clock, 6_000, [leaving], {})).toBe(5);
        expect(playingSeconds(clock, 1_000 + (10 + EXIT_SECONDS) * 1000, [leaving], {})).toBeNull();
        expect(playingSeconds(clock, 6_000, [leaving], { a: 999 })).toBeNull();
        expect(playingSeconds({ round: 0, startedAt: 0 }, 6_000, [leaving], {})).toBeNull();
    });
});

describe('次のラウンド', () => {
    it('始まりを秒の切れ目にそろえ、同じ秒に書いた人どうしで値がそろう', () => {
        expect(nextRoundStart(12_001)).toBe(13_000);
        expect(nextRoundStart(12_999)).toBe(13_000);
        expect(nextRoundStart(13_000)).toBe(13_000);
        expect(nextRoundStart(12_500, -9_999)).toBe(13_000);
        expect(nextRoundStart(12_500, 2_000)).toBe(15_000);
    });

    it('クリアしてから少し待つ。時計が大きく戻っても待ち続けない', () => {
        expect(clearDelayPassed(null, 1e9)).toBe(false);
        expect(clearDelayPassed(10_000, 10_000 + CLEAR_DELAY_MS - 1)).toBe(false);
        expect(clearDelayPassed(10_000, 10_000 + CLEAR_DELAY_MS)).toBe(true);
        expect(clearDelayPassed(10_000, 10_000 - CLEAR_DELAY_MS)).toBe(true);
        expect(clearCountdown(10_000, 10_100)).toBe(3);
        expect(clearCountdown(10_000, 10_000 + CLEAR_DELAY_MS + 5_000)).toBe(0);
        expect(clearCountdown(null, 0)).toBe(0);
    });
});

describe('startsOnBoard', () => {
    const running = (seconds: number) => ({ kind: 'running' as const, seconds, defeated: 0, total: 3 });

    it('ひとりで乗ったら最初から、ほかに乗っている人がいれば途中から加わる', () => {
        expect(startsOnBoard(running(30), false)).toBe(true);
        expect(startsOnBoard(running(30), true)).toBe(false);
        expect(startsOnBoard({ kind: 'idle' }, true)).toBe(true);
        expect(startsOnBoard({ ...running(30), kind: 'cleared' }, false)).toBe(true);
    });

    it('始まったばかり・始まりが未来のラウンドはやり直さない（乗り降りが揺れても 1 回だけ始める）', () => {
        expect(startsOnBoard(running(0.5), false)).toBe(false);
        expect(startsOnBoard(running(-0.8), false)).toBe(false);
    });
});
