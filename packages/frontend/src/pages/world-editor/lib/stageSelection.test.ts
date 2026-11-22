import type { InitialEntity } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import { flattenForStage } from './entityTree';
import { entityLabel, groupBounds, nudgeFor, outermostPrefabRoot, pressOnStage } from './stageSelection';

const entity = (id: string, patch: Partial<InitialEntity> = {}): InitialEntity => ({
    id,
    transform: { x: 0, y: 0, z: 0, scale: 1, rotation: 0 },
    components: [],
    tags: [],
    children: [],
    ...patch,
});

const link = {
    modId: 'pen',
    name: 'pen-set',
    version: '1.0.0',
    manifestIntegrity: `sha256-${'A'.repeat(43)}=`,
    entityIds: {},
};

// [0] 看板（ただの Entity）、[1] 置いたペンセット > [1,0] キャンバス・[1,1] 置き場 > [1,1,0] ペン
const world: InitialEntity[] = [
    entity('sign', { transform: { x: 10, y: 10, z: 1, w: 100, h: 40, scale: 1, rotation: 0 } }),
    entity('pen-set', {
        name: 'ペンセット',
        prefab: link,
        transform: { x: 500, y: 300, z: 2, scale: 1, rotation: 0 },
        children: [
            entity('canvas'),
            entity('tray', {
                transform: { x: 0, y: 0, z: 1, w: 266, h: 67, scale: 1, rotation: 0 },
                children: [
                    entity('pen-blue', { transform: { x: 9, y: 7, z: 6, w: 55, h: 48, scale: 1, rotation: 0 } }),
                ],
            }),
        ],
    }),
];

describe('pressOnStage', () => {
    it('プレハブの外の Entity は押したものを選ぶ', () => {
        expect(pressOnStage(world, [0], null)).toEqual({ select: [0], enterOnClick: null });
    });

    it('プレハブの中を押すと、まず一式（親）を選ぶ。深い子でも同じ', () => {
        expect(pressOnStage(world, [1, 1, 0], null)).toEqual({ select: [1], enterOnClick: null });
        expect(pressOnStage(world, [1, 0], [0])).toEqual({ select: [1], enterOnClick: null });
    });

    it('一式を選んでいるところで押すと、離したときに押した Entity に入る', () => {
        expect(pressOnStage(world, [1, 1, 0], [1])).toEqual({ select: [1], enterOnClick: [1, 1, 0] });
    });

    it('親そのものを押したときは入らない', () => {
        expect(pressOnStage(world, [1], [1])).toEqual({ select: [1], enterOnClick: null });
    });

    it('中に入った後は、同じプレハブの中の Entity をそのまま選ぶ', () => {
        expect(pressOnStage(world, [1, 1, 0], [1, 1])).toEqual({ select: [1, 1, 0], enterOnClick: null });
        expect(pressOnStage(world, [1, 0], [1, 1, 0])).toEqual({ select: [1, 0], enterOnClick: null });
    });

    it('ほかの Entity を選んでいても、プレハブの中はまず一式から', () => {
        expect(pressOnStage(world, [1, 1], [0])).toEqual({ select: [1], enterOnClick: null });
    });

    it('プレハブの中にプレハブがあっても、いちばん外を選ぶ', () => {
        const nested = [entity('outer', { prefab: link, children: [entity('inner', { prefab: link })] })];
        expect(outermostPrefabRoot(nested, [0, 0])).toEqual([0]);
        expect(pressOnStage(nested, [0, 0], null).select).toEqual([0]);
    });
});

describe('groupBounds', () => {
    it('子孫の大きさのある Entity を囲む（大きさの無いキャンバスは数えない）', () => {
        expect(groupBounds(flattenForStage(world), [1])).toEqual({ x: 500, y: 300, width: 266, height: 67 });
    });

    it('子がはみ出していれば、そこまで囲む', () => {
        const wide = [
            entity('root', {
                children: [
                    entity('a', { transform: { x: -20, y: 5, z: 0, w: 10, h: 10, scale: 1, rotation: 0 } }),
                    entity('b', { transform: { x: 100, y: 200, z: 0, w: 30, h: 40, scale: 1, rotation: 0 } }),
                ],
            }),
        ];
        expect(groupBounds(flattenForStage(wide), [0])).toEqual({ x: -20, y: 5, width: 150, height: 235 });
    });

    it('Component にだけ大きさのある子も、描かれる大きさで囲む（置いたプレハブの枠を中身に合わせる）', () => {
        const placed = [
            entity('sign-set', {
                prefab: link,
                transform: { x: 400, y: 360, z: 1, scale: 1, rotation: 0 },
                children: [
                    entity('sign', { components: [{ type: 'demo:sign', data: {}, transform: { w: 200, h: 80 } }] }),
                ],
            }),
        ];
        expect(groupBounds(flattenForStage(placed), [0])).toEqual({ x: 400, y: 360, width: 200, height: 80 });
    });

    it('大きさのある Entity が無ければ null（囲む枠を出さない）', () => {
        expect(groupBounds(flattenForStage([entity('empty', { children: [entity('dot')] })]), [0])).toBeNull();
    });

    it('[1] を囲むときに [10] を混ぜない（path の文字列の前方一致で間違えない）', () => {
        const many = Array.from({ length: 11 }, (_, i) =>
            entity(`e${i}`, { transform: { x: i * 100, y: 0, z: 0, w: 10, h: 10, scale: 1, rotation: 0 } }),
        );
        expect(groupBounds(flattenForStage(many), [1])).toEqual({ x: 100, y: 0, width: 10, height: 10 });
    });
});

describe('nudgeFor', () => {
    it('矢印は 1px、Shift で 10px。ほかのキーは動かさない', () => {
        expect(nudgeFor('ArrowLeft', false)).toEqual({ dx: -1, dy: 0 });
        expect(nudgeFor('ArrowDown', true)).toEqual({ dx: 0, dy: 10 });
        expect(nudgeFor('a', false)).toBeNull();
    });
});

describe('entityLabel', () => {
    it('表示名があれば表示名、空白だけなら id', () => {
        expect(entityLabel({ id: 'pen-set', name: 'ペンセット' })).toBe('ペンセット');
        expect(entityLabel({ id: 'pen-set', name: '   ' })).toBe('pen-set');
        expect(entityLabel({ id: 'pen-set' })).toBe('pen-set');
    });
});
