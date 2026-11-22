import type { InitialEntity } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import { applyDrag, type DragState } from './dragHelpers';
import { flattenForStage } from './entityTree';
import { contentBounds, placementFor } from './prefabPlacement';
import { groupBounds } from './stageSelection';

const WORLD = { width: 2000, height: 1500 };
const SNAP = { snapStep: 10, worldSize: WORLD };

const entity = (id: string, transform: Partial<InitialEntity['transform']>, children: InitialEntity[] = []) => ({
    id,
    transform: { x: 0, y: 0, z: 0, scale: 1, rotation: 0, ...transform },
    components: [],
    tags: [],
    children,
});

/** path の Entity を掴んだときのドラッグ（EditOverlay と同じく、一式の描かれる範囲を持つ） */
const grab = (entities: InitialEntity[], path: number[]): DragState => {
    const node = flattenForStage(entities).find((n) => n.path.join() === path.join());
    if (!node) throw new Error('no node');
    const t = node.entity.transform;
    const extent = groupBounds(flattenForStage(entities), path);
    if (!extent) throw new Error('no extent');
    return {
        path,
        mode: 'move',
        startClient: { x: 0, y: 0 },
        startTransform: { x: t.x, y: t.y, w: t.w ?? 0, h: t.h ?? 0 },
        extent,
    };
};

// 中身は親の原点から (400, 300) にある 200×80。(300, 200) に落とすと、親は (-200, -140) に置かれる
const content = [entity('sign', { x: 400, y: 300, w: 200, h: 80 })];
const placedAt = (drop: { x: number; y: number }) => {
    const at = placementFor(drop, contentBounds(content), WORLD);
    return [entity('sign-set', at, content)];
};

describe('applyDrag（グリッドに合わせるとき）', () => {
    it('置いたプレハブを少し動かしても、親の原点が負でも一式が飛ばない', () => {
        const world = placedAt({ x: 300, y: 200 });
        expect(world[0]?.transform).toMatchObject({ x: -200, y: -140 });
        expect(applyDrag(grab(world, [0]), 3, 2, SNAP)).toEqual({ x: -200, y: -140 });
        expect(applyDrag(grab(world, [0]), 7, 0, SNAP)).toEqual({ x: -190, y: -140 });
    });

    it('ワールドの左上・右下の端では、原点ではなく中身の端をそろえる', () => {
        const world = placedAt({ x: 300, y: 200 });
        // 中身の左上 = 親 + (400, 300) が (0, 0) で止まる
        expect(applyDrag(grab(world, [0]), -5000, -5000, SNAP)).toEqual({ x: -400, y: -300 });
        // 中身の右下 = 親 + (600, 380) がワールドの右下で止まる
        expect(applyDrag(grab(world, [0]), 5000, 5000, SNAP)).toEqual({ x: 1400, y: 1120 });
    });

    it('子は親からの相対の位置で、ワールドの端まで動かせる（相対の値を 0 で止めない）', () => {
        const world = [
            entity('table', { x: 500, y: 100, w: 300, h: 300 }, [entity('cup', { x: 10, y: 20, w: 40, h: 40 })]),
        ];
        expect(applyDrag(grab(world, [0, 0]), -5000, 0, SNAP)).toEqual({ x: -500, y: 20 });
    });

    it('一式は子孫まで含めて収める（子が親の外へはみ出していても、子がワールドから出ない）', () => {
        const world = [
            entity('table', { x: 100, y: 100, w: 100, h: 100 }, [entity('lamp', { x: 300, y: 0, w: 50, h: 50 })]),
        ];
        // 一式の右端 = 親 + 350。ワールドの右端 2000 で止まる
        expect(applyDrag(grab(world, [0]), 5000, 0, SNAP)).toEqual({ x: 1650, y: 100 });
    });

    it('中身がワールドより大きければ、中身の左上をワールドの端にそろえる', () => {
        const world = [entity('wall', { x: 50, y: 0, w: 3000, h: 40 })];
        expect(applyDrag(grab(world, [0]), 20, 0, SNAP)).toEqual({ x: 0, y: 0 });
    });

    it('グリッドを使わないときは寄せない（はみ出しても自由に置ける）', () => {
        const world = placedAt({ x: 300, y: 200 });
        expect(applyDrag(grab(world, [0]), -5000, 3, { worldSize: WORLD })).toEqual({ x: -5200, y: -137 });
    });

    it('大きさを変えるときは、今まで通り幅・高さをワールドの大きさまでにする', () => {
        const world = [entity('panel', { x: 0, y: 0, w: 100, h: 100 })];
        const drag = { ...grab(world, [0]), mode: 'resize-se' as const };
        expect(applyDrag(drag, 5000, 3, SNAP)).toEqual({ x: 0, y: 0, w: 2000, h: 100 });
    });
});
