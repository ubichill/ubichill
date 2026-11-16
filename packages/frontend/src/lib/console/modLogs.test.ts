import { describe, expect, it } from 'vitest';
import { diagnosticInput, modLogInput } from './modLogs';

describe('modLogInput', () => {
    it('warn は警告、error はエラー、info は情報にする', () => {
        expect(modLogInput({ level: 'warn', modId: 'pen:pen', message: 'a' })).toEqual({
            level: 'warning',
            source: 'pen:pen',
            message: 'a',
        });
        expect(modLogInput({ level: 'error', modId: 'pen', message: 'b' })?.level).toBe('error');
        expect(modLogInput({ level: 'info', modId: 'pen', message: 'c' })?.level).toBe('info');
    });

    it('debug は溜めない', () => {
        expect(modLogInput({ level: 'debug', modId: 'pen', message: 'tick' })).toBeNull();
    });

    it('出どころが分からなければ mod と書く', () => {
        expect(modLogInput({ level: 'info', modId: '', message: 'x' })?.source).toBe('mod');
    });
});

describe('diagnosticInput', () => {
    const denied = { level: 'warn', modId: 'video', code: 'CAPABILITY_DENIED', message: '通信を拒否しました' } as const;

    it('コードは補足に回し、文は診断のまま', () => {
        expect(diagnosticInput(denied)).toEqual({
            level: 'warning',
            source: 'video',
            message: '通信を拒否しました',
            detail: 'コード: CAPABILITY_DENIED',
        });
    });

    it('許可に変えられるときは操作を付ける', () => {
        const action = { label: '許可', run: () => {} };
        expect(diagnosticInput(denied, action).action).toBe(action);
    });
});
