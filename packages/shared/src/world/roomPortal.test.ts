import { describe, expect, it } from 'vitest';
import {
    isRoomPortalAddress,
    ROOM_PORTAL,
    RoomPortalDataSchema,
    roomPortalAddressFor,
    roomPortalCenter,
    roomPortalRemaining,
} from './roomPortal';

describe('isRoomPortalAddress', () => {
    it.each(['V1StGXR8_Z5jdHi6B-myT', 'abc@ubichill.example', 'abc@UBICHILL.example', 'abc@localhost:3001'])(
        '部屋の住所として読める: %s',
        (value) => {
            expect(isRoomPortalAddress(value)).toBe(true);
        },
    );

    it.each([
        '',
        'a@',
        '@example.com',
        'a@b@c',
        'a b',
        'a/b',
        '../x',
        'x'.repeat(65),
        `a@${'b'.repeat(320)}.com`,
        'https://example.com/instance/abc',
    ])('部屋の住所でないものは断る: %s', (value) => {
        expect(isRoomPortalAddress(value)).toBe(false);
    });
});

describe('RoomPortalDataSchema', () => {
    it('行き先と消える時刻だけを持つ', () => {
        const data = { room: 'abc', expiresAt: 1, ownerName: 'あや' };
        expect(RoomPortalDataSchema.safeParse(data).success).toBe(true);
        // ワールドに置くポータルの項目が混ざったものは、部屋へのポータルとして読まない
        expect(RoomPortalDataSchema.safeParse({ ...data, world: '@a/b' }).success).toBe(false);
        expect(RoomPortalDataSchema.safeParse({ world: '@abc/home' }).success).toBe(false);
        expect(RoomPortalDataSchema.safeParse({ ...data, expiresAt: 1.5 }).success).toBe(false);
        expect(RoomPortalDataSchema.safeParse({ ...data, expiresAt: -1 }).success).toBe(false);
        expect(RoomPortalDataSchema.safeParse({ room: 'abc', expiresAt: 1 }).success).toBe(false);
    });
});

describe('roomPortalAddressFor', () => {
    it('このサーバーの部屋にいる人には、書かれた住所のまま', () => {
        expect(roomPortalAddressFor('abc', 'here')).toBe('abc');
        expect(roomPortalAddressFor('abc@other.example', 'here')).toBe('abc@other.example');
    });

    it('ほかのサーバーの部屋にいる人には、部屋のサーバーのドメインを付ける', () => {
        expect(roomPortalAddressFor('abc', 'here@room.example')).toBe('abc@room.example');
        expect(roomPortalAddressFor('abc', 'here@room.example:8443')).toBe('abc@room.example:8443');
    });

    it('ドメインの付いた行き先は書き換えない（見る人のサーバーの部屋なら、サーバーがこのサーバーの部屋として読む）', () => {
        expect(roomPortalAddressFor('abc@viewer.example', 'here@room.example')).toBe('abc@viewer.example');
    });
});

describe('roomPortalCenter', () => {
    const world = { width: 2000, height: 1500 };

    it('見ている所の真ん中に置く', () => {
        expect(roomPortalCenter({ x: 1000, y: 700 }, world)).toEqual({ x: 1000, y: 700 });
    });

    it('ワールドの端では、はみ出さないよう内側に寄せる', () => {
        expect(roomPortalCenter({ x: -500, y: 99999 }, world)).toEqual({
            x: ROOM_PORTAL.WIDTH / 2,
            y: world.height - ROOM_PORTAL.HEIGHT / 2,
        });
    });

    it('ワールドがポータルより小さければ、ワールドの真ん中に置く', () => {
        expect(roomPortalCenter({ x: 10, y: 10 }, { width: 100, height: 120 })).toEqual({ x: 50, y: 60 });
    });

    it('整数の座標にする', () => {
        expect(roomPortalCenter({ x: 500.4, y: 600.6 }, world)).toEqual({ x: 500, y: 601 });
    });
});

describe('roomPortalRemaining', () => {
    it('残りの割合を 0〜1 で返す', () => {
        expect(roomPortalRemaining(ROOM_PORTAL.LIFETIME_MS, 0)).toBe(1);
        expect(roomPortalRemaining(ROOM_PORTAL.LIFETIME_MS / 2, 0)).toBe(0.5);
    });

    it('時計がずれていても範囲の外に出さない', () => {
        expect(roomPortalRemaining(1000, 5000)).toBe(0);
        expect(roomPortalRemaining(ROOM_PORTAL.LIFETIME_MS * 3, 0)).toBe(1);
    });
});
