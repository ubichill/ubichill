import { parsePortalTarget } from '@ubichill/core-components';
import { describe, expect, it } from 'vitest';
import { canonicalRoomId, portalPath } from './portalPath';

const path = (value: string) => {
    const target = parsePortalTarget(value);
    if (!target) throw new Error(value);
    return portalPath(target);
};

describe('portalPath', () => {
    it('行き先の書き方ごとに、ワールドのページへ', () => {
        expect(path('@alice/cafe')).toBe('/@alice/cafe');
        expect(path('@alice/作業部屋')).toBe(`/@alice/${encodeURIComponent('作業部屋')}`);
        expect(path('default')).toBe('/world/default');
        expect(path('https://example.com/w/cafe.yaml?x=1')).toBe(
            `/world?url=${encodeURIComponent('https://example.com/w/cafe.yaml?x=1')}`,
        );
    });

    it('部屋へのポータルは、その部屋へ（ほかのサーバーの部屋の住所もそのまま 1 つのパスにする）', () => {
        expect(portalPath({ kind: 'room', room: 'V1StGXR8_Z5jdHi6B-myT' })).toBe('/instance/V1StGXR8_Z5jdHi6B-myT');
        expect(portalPath({ kind: 'room', room: 'abc@room.example:8443' })).toBe(
            `/instance/${encodeURIComponent('abc@room.example:8443')}`,
        );
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
