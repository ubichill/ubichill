import { describe, expect, it } from 'vitest';
import { parseServerNotice } from './serverNotice';

describe('parseServerNotice', () => {
    it('切断の予告を読む', () => {
        expect(parseServerNotice({ kind: 'disconnect', at: 1_800_000_000_000 })).toEqual({
            kind: 'disconnect',
            at: 1_800_000_000_000,
        });
    });

    it.each([
        ['知らない種類', { kind: 'maintenance', at: 1 }],
        ['時刻が無い', { kind: 'disconnect' }],
        ['時刻が文字列', { kind: 'disconnect', at: '1800000000000' }],
        ['時刻が小数', { kind: 'disconnect', at: 1.5 }],
        ['時刻が負', { kind: 'disconnect', at: -1 }],
        ['null', null],
        ['文字列', 'disconnect'],
    ])('%s は読み飛ばす', (_label, data) => {
        expect(parseServerNotice(data)).toBeUndefined();
    });
});
