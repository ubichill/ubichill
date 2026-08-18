import { EMPTY_ENTITY_TYPE, type InitialEntity } from '@ubichill/shared';
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

    it('component.id (永続id) があればそれを flat id に使う（index フォールバックしない）', () => {
        const result = flattenGameObject(
            makeEntity({
                components: [
                    { id: 'health', type: 'core:health', data: {} },
                    { type: 'core:tag', data: {} }, // id 省略 → index フォールバック
                ],
            }),
        );
        expect(result.map((e) => e.id)).toEqual(['root::health', 'root::1']);
    });

    it('component.id があると、他 component の並べ替え・追加をしても flat id が変わらない', () => {
        const before = flattenGameObject(
            makeEntity({
                components: [
                    { id: 'a', type: 'x:a', data: {} },
                    { id: 'b', type: 'x:b', data: {} },
                ],
            }),
        );
        // 先頭に新しい component を挿入（index ベースなら既存2件のindexがずれる）
        const after = flattenGameObject(
            makeEntity({
                components: [
                    { id: 'new', type: 'x:new', data: {} },
                    { id: 'a', type: 'x:a', data: {} },
                    { id: 'b', type: 'x:b', data: {} },
                ],
            }),
        );
        expect(before.find((e) => e.type === 'x:a')?.id).toBe(after.find((e) => e.type === 'x:a')?.id);
        expect(before.find((e) => e.type === 'x:b')?.id).toBe(after.find((e) => e.type === 'x:b')?.id);
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

    it('component が無い Entity は EMPTY_ENTITY_TYPE の ComponentInstance を1件返す', () => {
        const result = flattenGameObject(makeEntity());
        expect(result).toHaveLength(1);
        expect(result[0].type).toBe(EMPTY_ENTITY_TYPE);
        expect(result[0].id).toBe('root::0');
        expect(result[0].entityId).toBe('root');
    });

    it('component 固有の transform 上書きが無ければ Entity の transform をそのまま継承する', () => {
        const result = flattenGameObject(
            makeEntity({
                transform: { x: 10, y: 20, z: 5, w: 60, h: 240, scale: 1, rotation: 0 },
                components: [
                    { type: 'pen:tray', data: {} },
                    { type: 'pen:pen', data: {} },
                ],
            }),
        );
        expect(result[0].transform).toEqual(result[1].transform);
        expect(result[1].transform.w).toBe(60);
        expect(result[1].transform.h).toBe(240);
    });

    it('component 固有の transform 上書きがあれば全フィールドを上書きする（x/y も絶対値で上書き）', () => {
        const result = flattenGameObject(
            makeEntity({
                transform: { x: 10, y: 20, z: 5, w: 60, h: 240, scale: 1, rotation: 0 },
                components: [
                    { type: 'pen:tray', data: {} },
                    { type: 'pen:pen', data: {}, transform: { x: 2, y: 3, w: 36, h: 48 } },
                ],
            }),
        );
        const pen = result[1];
        expect(pen.transform.x).toBe(2); // 上書き（10 + 2 ではない）
        expect(pen.transform.y).toBe(3); // 上書き（20 + 3 ではない）
        expect(pen.transform.w).toBe(36);
        expect(pen.transform.h).toBe(48);
        // z/rotation/scale は上書き指定が無いので Entity 側を継承する
        expect(pen.transform.z).toBe(5);
        expect(pen.transform.rotation).toBe(0);
        expect(pen.transform.scale).toBe(1);
        // tray 側は上書きしていないので Entity の transform をそのまま持つ
        expect(result[0].transform.w).toBe(60);
        expect(result[0].transform.h).toBe(240);
    });
});
