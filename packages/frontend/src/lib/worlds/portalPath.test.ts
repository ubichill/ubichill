import { describe, expect, it } from 'vitest';
import { canonicalRoomId, portalRoomPath } from './portalPath';

describe('portalRoomPath', () => {
    it('部屋の ID も、ほかのサーバーの部屋の住所も 1 つのパスにする', () => {
        expect(portalRoomPath('V1StGXR8_Z5jdHi6B-myT')).toBe('/instance/V1StGXR8_Z5jdHi6B-myT');
        expect(portalRoomPath('abc@room.example:8443')).toBe(
            `/instance/${encodeURIComponent('abc@room.example:8443')}`,
        );
        expect(portalRoomPath('../admin')).toBe(`/instance/${encodeURIComponent('../admin')}`);
    });
});

describe('canonicalRoomId', () => {
    it('自分のドメインを付けた住所で来て、このサーバーの部屋だったら、その ID にそろえる', () => {
        expect(canonicalRoomId('abc@ubichill.example', 'abc')).toBe('abc');
        expect(canonicalRoomId('abc@UBICHILL.example:443', 'abc')).toBe('abc');
    });

    it('同じ ID・ほかのサーバーの部屋（住所のまま）・空の ID はそろえない', () => {
        expect(canonicalRoomId('abc', 'abc')).toBeNull();
        expect(canonicalRoomId('abc@other.example', 'abc@other.example')).toBeNull();
        // ほかのサーバーの部屋の住所は、backend が正規の表記に直して返すことがある（大文字・ポート）が、移らない
        expect(canonicalRoomId('abc@Other.Example', 'abc@other.example')).toBeNull();
        expect(canonicalRoomId('abc@ubichill.example', '')).toBeNull();
    });
});
