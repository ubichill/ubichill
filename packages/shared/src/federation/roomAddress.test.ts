import { describe, expect, it } from 'vitest';
import { formatRoomAddress, isRemoteRoom, parseRoomAddress } from './roomAddress';

const SELF = 'home.example';

describe('parseRoomAddress', () => {
    it('ID だけならこのサーバーの部屋', () => {
        expect(parseRoomAddress('Qk_tRPXtQSKcFqwm4uDqC', SELF)).toEqual({ id: 'Qk_tRPXtQSKcFqwm4uDqC', domain: null });
    });

    it('`ID@ドメイン` はほかのサーバーの部屋。ドメインは小文字にそろえ、開発用のポートも受ける', () => {
        expect(parseRoomAddress('abc@Other.Example', SELF)).toEqual({ id: 'abc', domain: 'other.example' });
        expect(parseRoomAddress('abc@localhost:3201', SELF)).toEqual({ id: 'abc', domain: 'localhost:3201' });
    });

    it('自分のドメインを付けた住所は、このサーバーの部屋として扱う（自分に問い合わせない）', () => {
        expect(parseRoomAddress('abc@home.example', SELF)).toEqual({ id: 'abc', domain: null });
    });

    it.each([
        '',
        '@other.example',
        'abc@',
        'ab c@other.example',
        'abc@other.example/path',
        'abc@user@other.example',
        '../etc@other.example',
        'abc@other_example',
        `${'a'.repeat(65)}@other.example`,
    ])('不正な住所 %j は受けない', (input) => {
        expect(parseRoomAddress(input, SELF)).toBeNull();
    });
});

describe('formatRoomAddress', () => {
    it('往復できる', () => {
        for (const input of ['abc', 'abc@other.example']) {
            const parsed = parseRoomAddress(input, SELF);
            expect(parsed && formatRoomAddress(parsed)).toBe(input);
        }
        expect(isRemoteRoom({ id: 'a', domain: 'x.example' })).toBe(true);
        expect(isRemoteRoom({ id: 'a', domain: null })).toBe(false);
    });
});
