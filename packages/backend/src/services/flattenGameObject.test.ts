import type { InitialEntity } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import { flattenGameObject } from './flattenGameObject';

function makeEntity(overrides: Partial<InitialEntity> = {}): InitialEntity {
    return {
        id: 'root',
        transform: { x: 0, y: 0, z: 0, scale: 1, rotation: 0 },
        components: [],
        tags: [],
        children: [],
        ...overrides,
    };
}

describe('flattenGameObject', () => {
    it('1 component を 1 ComponentInstance に展開し、id を entityId と index から採番する', () => {
        const result = flattenGameObject(
            makeEntity({
                components: [{ type: 'pen:pen', data: { color: '#000' } }],
            }),
        );
        expect(result).toHaveLength(1);
        expect(result[0].id).toBe('root::0');
        expect(result[0].type).toBe('pen:pen');
        expect(result[0].entityId).toBe('root');
        expect(result[0].parentEntityId).toBeUndefined();
        expect(result[0].data).toEqual({ color: '#000' });
    });

    it('複数 component を複数 ComponentInstance に展開する', () => {
        const result = flattenGameObject(
            makeEntity({
                components: [
                    { type: 'a:a', data: {} },
                    { type: 'b:b', data: {} },
                ],
            }),
        );
        expect(result.map((e) => e.id)).toEqual(['root::0', 'root::1']);
    });

    it('w/h 未指定は 0 を入れる（サイズ未指定 = 自然サイズ尊重）', () => {
        const result = flattenGameObject(makeEntity({ components: [{ type: 'a:a', data: {} }] }));
        expect(result[0].transform.w).toBe(0);
        expect(result[0].transform.h).toBe(0);
    });

    it('子 Entity の transform は親 origin を加算して絶対化し、parentEntityId を付与する', () => {
        const result = flattenGameObject(
            makeEntity({
                id: 'parent',
                transform: { x: 10, y: 20, z: 5, scale: 1, rotation: 0 },
                components: [{ type: 'p:p', data: {} }],
                children: [
                    makeEntity({
                        id: 'child',
                        transform: { x: 3, y: 4, z: 2, scale: 1, rotation: 0 },
                        components: [{ type: 'c:c', data: {} }],
                    }),
                ],
            }),
        );

        const child = result.find((e) => e.entityId === 'child');
        expect(child?.transform.x).toBe(13); // 10 + 3
        expect(child?.transform.y).toBe(24); // 20 + 4
        expect(child?.transform.z).toBe(7); // 5 + 2
        expect(child?.parentEntityId).toBe('parent');
    });

    it('component が無い Entity は空配列を返す', () => {
        expect(flattenGameObject(makeEntity())).toEqual([]);
    });
});
