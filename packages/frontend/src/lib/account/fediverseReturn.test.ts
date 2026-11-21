import { describe, expect, it } from 'vitest';
import { readFediverseReturn, withoutFediverseReturn } from './fediverseReturn';

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
