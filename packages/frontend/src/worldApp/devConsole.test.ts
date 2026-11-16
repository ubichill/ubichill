import { describe, expect, it } from 'vitest';
import { devFailureKey, devFailureLog } from './devConsole';

describe('devFailureLog', () => {
    it('ビルドとワールドの失敗はエラー、参照の問題は警告', () => {
        expect(devFailureLog({ kind: 'build', mod: 'pen', message: 'x.ts: 型が合いません' })).toEqual({
            level: 'error',
            source: 'pen',
            message: 'ビルドに失敗しました: x.ts: 型が合いません',
        });
        expect(devFailureLog({ kind: 'reference', message: 'tray-2 がありません' }).level).toBe('warning');
        expect(devFailureLog({ kind: 'world', message: 'YAML を読めません' })).toMatchObject({
            level: 'error',
            source: 'ワールド',
        });
    });
});

describe('devFailureKey', () => {
    it('種類・mod・文が同じなら同じ、どれかが違えば別', () => {
        const a = { kind: 'build', mod: 'pen', message: 'm' } as const;
        expect(devFailureKey(a)).toBe(devFailureKey({ ...a }));
        expect(devFailureKey(a)).not.toBe(devFailureKey({ ...a, mod: 'danmaku' }));
        expect(devFailureKey({ kind: 'world', message: 'm' })).not.toBe(
            devFailureKey({ kind: 'reference', message: 'm' }),
        );
    });
});
