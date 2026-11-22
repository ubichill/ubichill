import type { ComponentInstance } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import { isHitArea, partLook, stackingOrder } from './partLook';

type Part = Pick<ComponentInstance, 'type' | 'data' | 'entityId'>;

const part = (type: string, entityId: string | undefined, data: Record<string, unknown> = {}): Part => ({
    type,
    entityId,
    data,
});
const hitArea = (type: string, entityId: string | undefined) => part(type, entityId, { look: 'none' });
const order = (parts: Array<[string, Part]>) => stackingOrder(new Map(parts));

describe('partLook', () => {
    it('押せる部品は、書いていなければ標準', () => {
        for (const type of ['core:warp', 'core:switch', 'core:portal']) {
            expect(partLook(part(type, 'e'))).toBe('standard');
            expect(partLook(part(type, 'e', { look: 'none' }))).toBe('none');
        }
    });

    it('押せる部品でないもの・読めない data は null（押せる場所にしない）', () => {
        expect(partLook(part('core:image', 'e', { look: 'none' }))).toBeNull();
        expect(partLook(part('pen:pen', 'e', { look: 'none' }))).toBeNull();
        // 知らない見た目は標準として読む（押せる場所にはしない）
        expect(partLook(part('core:warp', 'e', { look: 'glow' }))).toBe('standard');
        expect(partLook(part('core:warp', 'e', { target: 'Bad ID', look: 'none' }))).toBeNull();
        expect(isHitArea(part('core:warp', 'e', { look: 'glow' }))).toBe(false);
    });

    it('知らない項目があっても見た目は読む（新しい ubichill のワールド）', () => {
        expect(isHitArea(part('core:switch', 'e', { look: 'none', glow: true }))).toBe(true);
    });
});

describe('stackingOrder', () => {
    it('押せる場所を、同じ Entity の画像・文字の後ろ（上）に回す', () => {
        expect(
            order([
                ['door:warp', hitArea('core:warp', 'door')],
                ['door:image', part('core:image', 'door')],
                ['door:text', part('core:text', 'door')],
            ]),
        ).toEqual(['door:image', 'door:text', 'door:warp']);
    });

    it('すでに後ろなら動かさない。標準の見た目は動かさない', () => {
        const parts: Array<[string, Part]> = [
            ['a:image', part('core:image', 'a')],
            ['a:warp', hitArea('core:warp', 'a')],
            ['b:switch', part('core:switch', 'b')],
            ['b:image', part('core:image', 'b')],
        ];
        expect(order(parts)).toEqual(['a:image', 'a:warp', 'b:switch', 'b:image']);
    });

    it('ほかの Entity との順は変えない（子の Entity は別の Entity）', () => {
        expect(
            order([
                ['parent:warp', hitArea('core:warp', 'parent')],
                ['parent:image', part('core:image', 'parent')],
                ['child:image', part('core:image', 'child')],
                ['other:text', part('core:text', 'other')],
            ]),
        ).toEqual(['parent:image', 'parent:warp', 'child:image', 'other:text']);
    });

    it('同じ Entity の部品が離れていても、最後の部品の直後に置く（前へは動かさない）', () => {
        expect(
            order([
                ['a:image', part('core:image', 'a')],
                ['b:image', part('core:image', 'b')],
                ['a:warp', hitArea('core:warp', 'a')],
            ]),
        ).toEqual(['a:image', 'b:image', 'a:warp']);
        expect(
            order([
                ['a:warp', hitArea('core:warp', 'a')],
                ['b:image', part('core:image', 'b')],
                ['a:text', part('core:text', 'a')],
                ['c:image', part('core:image', 'c')],
            ]),
        ).toEqual(['b:image', 'a:text', 'a:warp', 'c:image']);
    });

    it('押せる場所が複数あっても、元の順のまま後ろに並べる', () => {
        expect(
            order([
                ['a:switch', hitArea('core:switch', 'a')],
                ['a:portal', hitArea('core:portal', 'a')],
                ['a:image', part('core:image', 'a')],
            ]),
        ).toEqual(['a:image', 'a:switch', 'a:portal']);
    });

    it('押せる場所だけの Entity と、Entity の ID の無い部品はそのまま', () => {
        expect(
            order([
                ['solo', hitArea('core:warp', 'solo')],
                ['legacy:warp', hitArea('core:warp', undefined)],
                ['legacy:image', part('core:image', undefined)],
            ]),
        ).toEqual(['solo', 'legacy:warp', 'legacy:image']);
    });

    it('空なら空', () => {
        expect(order([])).toEqual([]);
    });
});
