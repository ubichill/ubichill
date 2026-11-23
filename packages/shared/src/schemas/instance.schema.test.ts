import { describe, expect, it } from 'vitest';
import { ROOM_PORTAL } from '../world/roomPortal';
import { CreateInstanceRequestSchema } from './instance.schema';

describe('CreateInstanceRequestSchema の holdEmptyMs', () => {
    const parse = (holdEmptyMs: unknown) => CreateInstanceRequestSchema.safeParse({ worldId: 'w', holdEmptyMs });

    it('省いてよい（ふつうの部屋）', () => {
        const result = CreateInstanceRequestSchema.safeParse({ worldId: 'w' });
        expect(result.success).toBe(true);
        expect(result.data?.holdEmptyMs).toBeUndefined();
    });

    it('1ms からポータルの寿命まで受け付ける', () => {
        expect(parse(1).data?.holdEmptyMs).toBe(1);
        expect(parse(ROOM_PORTAL.LIFETIME_MS).data?.holdEmptyMs).toBe(ROOM_PORTAL.LIFETIME_MS);
    });

    it.each([
        ['0', 0],
        ['負の数', -1],
        ['整数でない', 1.5],
        ['ポータルの寿命より長い', ROOM_PORTAL.LIFETIME_MS + 1],
        ['無限大', Number.POSITIVE_INFINITY],
        ['NaN', Number.NaN],
        ['文字列の数', '60000'],
        ['null', null],
    ])('%s は受け付けない（部屋を長く残させない）', (_label, value) => {
        expect(parse(value).success).toBe(false);
    });
});
