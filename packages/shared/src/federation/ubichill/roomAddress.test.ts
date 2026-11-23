import { describe, expect, it } from 'vitest';
import { hostOf } from '../urls';
import { formatRoomAddress, isRemoteRoom, localRoomIdOf, parseRoomAddress, roomIdOf } from './roomAddress';

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

    it('既定のポート（:443）・頭に 0 の付いたポートは、URL のホストと同じ形にそろえる（自分のドメインも同じ）', () => {
        expect(parseRoomAddress('abc@home.example:443', SELF)).toEqual({ id: 'abc', domain: null });
        expect(parseRoomAddress('abc@HOME.example:0443', SELF)).toEqual({ id: 'abc', domain: null });
        expect(parseRoomAddress('abc@other.example:443', SELF)).toEqual({ id: 'abc', domain: 'other.example' });
        expect(parseRoomAddress('abc@other.example:08443', SELF)).toEqual({ id: 'abc', domain: 'other.example:8443' });
        expect(parseRoomAddress('abc@localhost:3201', 'localhost:03201')).toEqual({ id: 'abc', domain: null });
        expect(parseRoomAddress('abc@other.example:99999', SELF)).toBeNull();
    });

    it('住所のドメインは、部屋の URL のホスト（hostOf）と同じ読み方になる（入る前の確認で食い違わない）', () => {
        for (const domain of [
            'other.example',
            'Other.Example:443',
            'other.example:0443',
            'other.example:8443',
            'localhost:3201',
        ]) {
            expect(parseRoomAddress(`abc@${domain}`, SELF)?.domain).toBe(hostOf(`https://${domain}/ap/instances/abc`));
        }
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

describe('roomIdOf', () => {
    it('部屋のサーバーでの ID（住所の @ より前）', () => {
        expect(roomIdOf('r1@b.example')).toBe('r1');
        expect(roomIdOf('r1@localhost:3201')).toBe('r1');
        expect(roomIdOf('r1')).toBe('r1');
    });
});

describe('localRoomIdOf', () => {
    it('自分のドメインを付けた住所は、このサーバーの部屋の ID にする（大文字でも）', () => {
        expect(localRoomIdOf('abc@home.example', SELF)).toBe('abc');
        expect(localRoomIdOf('abc@HOME.example', SELF)).toBe('abc');
        expect(localRoomIdOf('abc', SELF)).toBe('abc');
    });

    it('ほかのサーバーの部屋・不正な住所はそのまま（このサーバーの部屋と取り違えない）', () => {
        expect(localRoomIdOf('abc@other.example', SELF)).toBe('abc@other.example');
        expect(localRoomIdOf('abc@home.example.evil', SELF)).toBe('abc@home.example.evil');
        expect(localRoomIdOf('a b@home.example', SELF)).toBe('a b@home.example');
    });
});
