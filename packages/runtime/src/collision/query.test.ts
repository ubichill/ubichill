import { describe, expect, it } from 'vitest';
import type { ColliderData } from '../collider/types.js';
import type { ColliderInstance } from './contacts.js';
import { findOverlapping, isOverlapping } from './query.js';

function collider(
    id: string,
    x: number,
    y: number,
    overrides: Partial<ColliderData> & { entityId?: string } = {},
): ColliderInstance {
    const { entityId, ...data } = overrides;
    return {
        id,
        entityId,
        transform: { x, y, w: 10, h: 10 },
        data: {
            shape: 'rect',
            size: 'entity',
            offset: { x: 0, y: 0 },
            isTrigger: false,
            layer: 'default',
            mask: ['default'],
            ...data,
        } as ColliderData,
    };
}

const probeAt = (x: number, y: number, overrides: Partial<ColliderData> & { entityId?: string } = {}) => {
    const { entityId, ...data } = overrides;
    return {
        entityId,
        transform: { x, y, w: 10, h: 10 },
        data: {
            shape: 'rect',
            size: 'entity',
            offset: { x: 0, y: 0 },
            isTrigger: false,
            layer: 'default',
            mask: ['default'],
            ...data,
        } as ColliderData,
    };
};

describe('findOverlapping', () => {
    it('重なっている相手だけを返す', () => {
        const world = [collider('near', 5, 5), collider('far', 500, 500)];
        expect(findOverlapping(probeAt(0, 0), world).map((c) => c.id)).toEqual(['near']);
    });

    it('重なりが無ければ空', () => {
        expect(findOverlapping(probeAt(0, 0), [collider('far', 500, 500)])).toEqual([]);
    });

    it('渡された順序を保つ', () => {
        const world = [collider('first', 1, 1), collider('second', 2, 2), collider('third', 3, 3)];
        expect(findOverlapping(probeAt(0, 0), world).map((c) => c.id)).toEqual(['first', 'second', 'third']);
    });

    // 自分の当たり判定に自分でぶつかって動けなくなるのを防ぐ。
    it('同じ GameObject 上の collider は除外する', () => {
        const world = [collider('own', 1, 1, { entityId: 'me' }), collider('other', 2, 2, { entityId: 'you' })];
        expect(findOverlapping(probeAt(0, 0, { entityId: 'me' }), world).map((c) => c.id)).toEqual(['other']);
    });

    it('entityId を指定しなければ何も除外しない', () => {
        const world = [collider('a', 1, 1, { entityId: 'me' })];
        expect(findOverlapping(probeAt(0, 0), world).map((c) => c.id)).toEqual(['a']);
    });

    it('layer/mask が双方向に噛み合う相手だけ返す', () => {
        const world = [
            collider('matching', 1, 1, { layer: 'ground', mask: ['body'] }),
            collider('oneWay', 2, 2, { layer: 'ground', mask: ['other'] }),
        ];
        const probe = probeAt(0, 0, { layer: 'body', mask: ['ground'] });
        expect(findOverlapping(probe, world).map((c) => c.id)).toEqual(['matching']);
    });

    // 何を「当たった」とみなすかは呼び出し側の方針なので、ここでは相手を素通しで返す。
    it('isTrigger の相手も返す（解釈は呼び出し側に委ねる）', () => {
        const world = [collider('sensor', 1, 1, { isTrigger: true })];
        expect(findOverlapping(probeAt(0, 0), world).map((c) => c.id)).toEqual(['sensor']);
    });

    it('probe はワールドに登録されていなくてよい（Entity でない点も判定できる）', () => {
        const point = {
            transform: { x: 5, y: 5 },
            data: {
                shape: 'circle',
                radius: 2,
                offset: { x: 0, y: 0 },
                isTrigger: true,
                layer: 'default',
                mask: ['default'],
            } as ColliderData,
        };
        expect(findOverlapping(point, [collider('area', 0, 0)]).map((c) => c.id)).toEqual(['area']);
    });

    it('空のワールドでも落ちない', () => {
        expect(findOverlapping(probeAt(0, 0), [])).toEqual([]);
    });
});

describe('isOverlapping', () => {
    it('1 つでも重なっていれば true', () => {
        expect(isOverlapping(probeAt(0, 0), [collider('a', 5, 5)])).toBe(true);
    });

    it('どれとも重なっていなければ false', () => {
        expect(isOverlapping(probeAt(0, 0), [collider('a', 500, 500)])).toBe(false);
    });

    it('除外規則は findOverlapping と同じ', () => {
        const world = [collider('own', 1, 1, { entityId: 'me' })];
        expect(isOverlapping(probeAt(0, 0, { entityId: 'me' }), world)).toBe(false);
    });
});
