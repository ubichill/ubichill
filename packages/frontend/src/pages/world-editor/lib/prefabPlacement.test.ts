import type { InitialEntity } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import { entityWithComponentAt } from './addComponent';
import { decodePrefabDrag, encodePrefabDrag } from './dnd';
import { contentBounds, placementFor } from './prefabPlacement';

const box = (id: string, x: number, y: number, w?: number, h?: number, children: InitialEntity[] = []) => ({
    id,
    transform: { x, y, z: 0, w, h, scale: 1, rotation: 0 },
    components: [],
    tags: [],
    children,
});

describe('contentBounds', () => {
    it('子の位置は親からの相対で足し、大きさの無い Entity は数えない', () => {
        const entities = [box('canvas', 0, 0), box('tray', 10, 20, 266, 67, [box('pen', 9, 7, 55, 48)])];
        expect(contentBounds(entities)).toEqual({ x: 10, y: 20, width: 266, height: 67 });
    });

    it('子が親の外にはみ出していれば含める', () => {
        expect(contentBounds([box('tray', 10, 10, 20, 20, [box('pen', 100, 100, 10, 10)])])).toEqual({
            x: 10,
            y: 10,
            width: 110,
            height: 110,
        });
    });

    it('大きさのある Entity が 1 つも無ければ null', () => {
        expect(contentBounds([box('a', 5, 5), box('b', 0, 0)])).toBeNull();
    });
});

describe('placementFor', () => {
    const bounds = { x: 10, y: 20, width: 200, height: 100 };

    it('中身の真ん中が置いた場所に来る', () => {
        // 中身の真ん中 = 親 + (10 + 100, 20 + 50)
        expect(placementFor({ x: 500, y: 400 }, bounds)).toEqual({ x: 390, y: 330 });
    });

    it('ワールドの端に落としても、中身がはみ出さない位置に寄せる', () => {
        const world = { width: 1000, height: 800 };
        expect(placementFor({ x: 0, y: 0 }, bounds, world)).toEqual({ x: -10, y: -20 });
        expect(placementFor({ x: 1000, y: 800 }, bounds, world)).toEqual({ x: 790, y: 680 });
    });

    it('中身がワールドより大きければ、左上をワールドの端にそろえる', () => {
        expect(
            placementFor({ x: 50, y: 50 }, { x: 0, y: 0, width: 3000, height: 50 }, { width: 1000, height: 800 }),
        ).toEqual({ x: 0, y: 25 });
    });

    it('中身に大きさが無ければ、親をその場所に置く（半端な px にしない）', () => {
        expect(placementFor({ x: 10.6, y: 20.2 }, null)).toEqual({ x: 11, y: 20 });
    });
});

describe('entityWithComponentAt', () => {
    const kind = {
        kind: 'core:image',
        modName: 'core',
        displayName: '画像',
        defaultTransform: { w: 320, h: 180 },
        suggestSize: true,
        viewKind: 'logic' as const,
    };

    it('部品の大きさで真ん中を落とした場所に置き、部品の名前を表示名にする', () => {
        const created = entityWithComponentAt('core:image', kind, { x: 400, y: 300 }, [box('image', 0, 0)]);
        expect(created.id).toBe('image-2');
        expect(created.name).toBe('画像');
        expect(created.transform).toMatchObject({ x: 240, y: 210, w: 320, h: 180 });
        expect(created.components.map((c) => c.type)).toEqual(['core:image']);
    });

    it('知らない部品（mod の取得前）でも既定の大きさで作る', () => {
        const created = entityWithComponentAt('demo:thing', undefined, { x: 0, y: 0 }, [], { width: 500, height: 500 });
        expect(created.name).toBeUndefined();
        expect(created.transform).toMatchObject({ x: 0, y: 0, w: 200, h: 150 });
    });
});

describe('prefab drag', () => {
    it('運んだ値を読み戻せる', () => {
        expect(decodePrefabDrag(encodePrefabDrag({ modId: 'pen', name: 'pen-set' }))).toEqual({
            modId: 'pen',
            name: 'pen-set',
        });
    });

    it('ほかのページから落とされた文字列は読まない', () => {
        expect(decodePrefabDrag('')).toBeNull();
        expect(decodePrefabDrag('https://example.com/a/b')).toBeNull();
        expect(decodePrefabDrag('pen/pen-set/extra')).toBeNull();
        expect(decodePrefabDrag('Pen/Set')).toBeNull();
    });
});
