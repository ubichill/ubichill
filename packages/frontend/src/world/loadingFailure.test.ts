import { describe, expect, it } from 'vitest';
import { loadingFailure, markFor, TIMEOUT_MESSAGE } from './loadingFailure';

const base = { error: null, isJoined: false, isConnecting: false, timedOut: false, complete: false };

describe('markFor', () => {
    it('同じ部屋の印だけを読む', () => {
        expect(markFor({ instanceId: 'a', value: true }, 'a')).toBe(true);
        expect(markFor(null, 'a')).toBeNull();
    });

    it('前の部屋で 25 秒たった印は、移った先の部屋では無いのと同じ（入る前にタイムアウトにしない）', () => {
        const timedOutInRoomA = { instanceId: 'a', value: true };
        const timedOut = markFor(timedOutInRoomA, 'b') ?? false;
        // 移った直後は前の部屋を抜けて、まだつないでいない
        expect(loadingFailure({ ...base, timedOut })).toBeNull();
    });

    it('前の部屋の失敗を、移った先の部屋の失敗として読まない', () => {
        expect(markFor({ instanceId: 'a', value: TIMEOUT_MESSAGE }, 'b')).toBeNull();
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
