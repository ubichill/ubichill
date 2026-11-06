import { describe, expect, it } from 'vitest';
import { debugFromEnv } from './debug';

describe('debugFromEnv', () => {
    it('DEBUG=true / false が最優先（本番でも true にできる）', () => {
        expect(debugFromEnv('true', 'production')).toBe(true);
        expect(debugFromEnv('false', 'development')).toBe(false);
    });

    it('未指定なら本番だけ無効', () => {
        expect(debugFromEnv(undefined, 'production')).toBe(false);
        expect(debugFromEnv(undefined, 'development')).toBe(true);
        expect(debugFromEnv(undefined, undefined)).toBe(true);
    });

    it('true / false 以外の値は未指定と同じ（TRUE や 1 は受けない。設定の解釈と同じ）', () => {
        expect(debugFromEnv('1', 'production')).toBe(false);
        expect(debugFromEnv('TRUE', 'production')).toBe(false);
    });
});
