import { describe, expect, it } from 'vitest';
import { parseSignInIdentifier } from './signInIdentifier';

describe('parseSignInIdentifier', () => {
    it('@ を含むものはメールアドレスとしてそのまま渡す', () => {
        expect(parseSignInIdentifier(' Alice@Example.com ')).toEqual({ kind: 'email', email: 'Alice@Example.com' });
    });

    it('それ以外は ID。小文字にする', () => {
        expect(parseSignInIdentifier(' Alice ')).toEqual({ kind: 'handle', handle: 'alice' });
    });
});
