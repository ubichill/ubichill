import { describe, expect, it } from 'vitest';
import { readFediverseReturn, returnPathOf, withoutFediverseReturn } from './fediverseReturn';

describe('returnPathOf', () => {
    it('ProtectedRoute の Location のオブジェクトも、ほかの画面の文字列も相対 URL の文字列にする', () => {
        expect(
            returnPathOf({ from: { pathname: '/instance/abc', search: '?x=1', hash: '#h', state: null, key: 'k' } }),
        ).toBe('/instance/abc?x=1#h');
        expect(returnPathOf({ from: '/@bob/room' })).toBe('/@bob/room');
    });

    it('無い・外への URL・おかしな形は / にする', () => {
        for (const state of [
            null,
            undefined,
            {},
            { from: 'https://evil.example' },
            { from: { pathname: '//evil' } },
            { from: 1 },
        ]) {
            expect(returnPathOf(state)).toBe('/');
        }
    });
});

describe('readFediverseReturn', () => {
    it('登録・連携・失敗を読み分け、知らないエラーは一般的な文にする', () => {
        expect(readFediverseReturn('?fediverse=sign-up')).toEqual({
            signUp: true,
            linked: false,
            alreadyRegistered: false,
            error: null,
        });
        expect(readFediverseReturn('?fediverse=already-registered')).toMatchObject({ alreadyRegistered: true });
        expect(readFediverseReturn('?x=1&fediverse=linked')).toMatchObject({ linked: true });
        expect(readFediverseReturn('?fediverse_error=denied').error).toBe('ログインが取り消されました');
        expect(readFediverseReturn('?fediverse_error=%3Cscript%3E').error).toBe(
            readFediverseReturn('?fediverse_error=failed').error,
        );
        expect(readFediverseReturn('')).toEqual({
            signUp: false,
            linked: false,
            alreadyRegistered: false,
            error: null,
        });
    });
});

describe('withoutFediverseReturn', () => {
    it('戻りのクエリだけ外し、ほかは残す', () => {
        expect(withoutFediverseReturn('?a=1&fediverse=linked&b=2')).toBe('?a=1&b=2');
        expect(withoutFediverseReturn('?fediverse_error=denied')).toBe('');
    });
});
