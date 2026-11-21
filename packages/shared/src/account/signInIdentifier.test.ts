import { describe, expect, it } from 'vitest';
import { parseSignInIdentifier } from './signInIdentifier';

describe('parseSignInIdentifier', () => {
    it('@ を含むものはメールアドレスとしてそのまま渡す', () => {
        expect(parseSignInIdentifier(' Alice@Example.com ')).toEqual({ kind: 'email', email: 'Alice@Example.com' });
    });

    it('それ以外は ID。先頭の @ を外し、小文字にする', () => {
        expect(parseSignInIdentifier('alice')).toEqual({ kind: 'handle', handle: 'alice' });
        expect(parseSignInIdentifier(' @Alice ')).toEqual({ kind: 'handle', handle: 'alice' });
    });

    it('@ID@サーバー の形はメールアドレスとして扱う（ほかのサーバーのアカウントではログインできない）', () => {
        expect(parseSignInIdentifier('@alice@mi.example')).toEqual({ kind: 'email', email: '@alice@mi.example' });
    });
});
