import { describe, expect, it } from 'vitest';
import { loadingFailure, markFor, nextEntry, TIMEOUT_MESSAGE } from './loadingFailure';

const base = { error: null, isJoined: false, isConnecting: false, timedOut: false, complete: false };

describe('markFor', () => {
    it('同じ入室の印だけを読む', () => {
        expect(markFor({ attempt: 1, value: true }, 1)).toBe(true);
        expect(markFor(null, 1)).toBeNull();
    });

    it('前の入室で 25 秒たった印は、今の入室では無いのと同じ（入る前にタイムアウトにしない）', () => {
        const timedOut = markFor({ attempt: 1, value: true }, 2) ?? false;
        // 移った直後は前の部屋を抜けて、まだつないでいない
        expect(loadingFailure({ ...base, timedOut })).toBeNull();
    });

    it('前の入室の失敗を、今の入室の失敗として読まない', () => {
        expect(markFor({ attempt: 1, value: TIMEOUT_MESSAGE }, 2)).toBeNull();
    });
});

describe('nextEntry', () => {
    it('部屋が変わるたびに番号を進め、同じ部屋へ戻っても前の番号に戻さない', () => {
        const a = { instanceId: 'a', attempt: 0 };
        const b = nextEntry(a, 'b');
        const backToA = nextEntry(b, 'a');
        expect([a.attempt, b.attempt, backToA.attempt]).toEqual([0, 1, 2]);
    });

    it('部屋が変わらなければ同じもの（描き直しで番号を進めない）', () => {
        const a = { instanceId: 'a', attempt: 3 };
        expect(nextEntry(a, 'a')).toBe(a);
    });
});

describe('loadingFailure', () => {
    it('入れないまま時間が来たら、タイムアウト', () => {
        expect(loadingFailure({ ...base, timedOut: true })).toBe(TIMEOUT_MESSAGE);
    });

    it('つないでいる途中・入れた後・全部揃った後は、時間が来ても失敗にしない', () => {
        expect(loadingFailure({ ...base, timedOut: true, isConnecting: true })).toBeNull();
        expect(loadingFailure({ ...base, timedOut: true, isJoined: true })).toBeNull();
        expect(loadingFailure({ ...base, timedOut: true, complete: true })).toBeNull();
    });

    it('入れていない間のエラーは失敗。入った後のエラーでは追い出さない', () => {
        expect(loadingFailure({ ...base, error: '満員です' })).toBe('満員です');
        expect(loadingFailure({ ...base, error: '満員です', isJoined: true })).toBeNull();
    });
});
