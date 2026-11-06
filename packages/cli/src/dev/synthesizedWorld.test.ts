import { definitionToResolved, flattenGameObject, WorldSourceKind } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import { componentsFromManifest, synthesizeWorld } from './synthesizedWorld.ts';

const url = 'file:///dev/world.yaml';
const resolve = (raw: unknown) => definitionToResolved(raw, url, { kind: WorldSourceKind.Local, url });
/** Go に渡すのと同じ flatten をした ComponentInstance（Component 型 → 実体）。 */
const flat = (raw: unknown) =>
    Object.fromEntries(
        resolve(raw)
            .initialEntities.flatMap((e) => flattenGameObject(e))
            .filter((c) => !c.type.startsWith('__'))
            .map((c) => [c.type, c]),
    );

const videoplayer = {
    id: 'video-player',
    components: [
        { type: 'video-player:screen', defaultTransform: { x: 0, y: 0, z: 2, w: 640, h: 360 } },
        { type: 'video-player:controls', defaultTransform: { x: 0, y: 370, w: 640, h: 60 } },
        { type: 'video-player:playlist', defaultTransform: { x: 0, y: 440, w: 310, h: 300 } },
        { type: 'video-player:search', defaultTransform: { x: 330, y: 440, w: 310, h: 300 } },
    ],
};

describe('synthesizeWorld', () => {
    it('Component を同じ親の下の別々の子にする（scope: siblings のイベントが届く形。実際のワールドと同じ）', () => {
        const c = flat(synthesizeWorld([videoplayer]));
        const parents = new Set(Object.values(c).map((i) => i.parentEntityId));
        const entities = new Set(Object.values(c).map((i) => i.entityId));
        expect(parents).toEqual(new Set(['video-player']));
        expect(entities.size).toBe(4);
    });

    it('mod が宣言した defaultTransform の並びを保って、左上に置く', () => {
        const c = flat(synthesizeWorld([videoplayer]));
        expect(c['video-player:screen']?.transform).toMatchObject({ x: 48, y: 48, w: 640, h: 360, z: 2 });
        expect(c['video-player:controls']?.transform).toMatchObject({ x: 48, y: 48 + 370 });
        expect(c['video-player:search']?.transform).toMatchObject({ x: 48 + 330, y: 48 + 440 });
        // 最初の画面（1280×800）に screen と controls が入る
        expect(c['video-player:controls']?.transform.y).toBeLessThan(800);
    });

    it('mod ごとにまとめて横に並べ、重ならない', () => {
        const pen = { id: 'pen', components: [{ type: 'pen:pen', defaultTransform: { x: 0, y: 0, w: 55, h: 48 } }] };
        const c = flat(synthesizeWorld([videoplayer, pen]));
        expect(c['pen:pen']?.transform.x).toBeGreaterThanOrEqual(48 + 640);
        expect(c['pen:pen']?.transform.y).toBe(48);
        expect(c['pen:pen']?.parentEntityId).toBe('pen');
    });

    it('defaultTransform の無い Component は宣言のある Component の下に横に並べ、画面固定の Component は画面の座標のまま', () => {
        const c = flat(
            synthesizeWorld([
                {
                    id: 'mix',
                    components: [
                        { type: 'mix:a', defaultTransform: { x: 0, y: 0, w: 100, h: 100 } },
                        { type: 'mix:b' },
                        { type: 'mix:c' },
                        { type: 'mix:hud', overlay: 'bottom-left', defaultTransform: { x: 24, y: 24 } },
                    ],
                },
            ]),
        );
        expect(c['mix:b']?.transform.y).toBe(48 + 100 + 48);
        expect((c['mix:c']?.transform.x ?? 0) - (c['mix:b']?.transform.x ?? 0)).toBe(240 + 48);
        expect(c['mix:hud']?.overlay).toBe('bottom-left');
        expect(c['mix:hud']?.transform).toMatchObject({ x: 24, y: 24 });
    });

    it('どれもスキーマを通り、mod が無ければ空のワールド。ワールドは置いたものより広い', () => {
        expect(resolve(synthesizeWorld([])).initialEntities).toEqual([]);
        const wide = synthesizeWorld(
            Array.from({ length: 5 }, (_, i) => ({
                id: `m${i}`,
                components: [{ type: `m${i}:x`, defaultTransform: { w: 640, h: 400 } }],
            })),
        );
        const world = resolve(wide);
        expect(world.environment.worldSize.width).toBeGreaterThan(48 + 5 * (640 + 48) - 48);
        expect(world.dependencies?.map((d) => d.name)).toEqual(['m0', 'm1', 'm2', 'm3', 'm4']);
    });
});

describe('componentsFromManifest', () => {
    it('manifest から defaultTransform と overlay を読み、読めなければ型だけ', () => {
        const manifest = new TextEncoder().encode(
            JSON.stringify({ components: { 'a:x': { defaultTransform: { w: 10, h: 20 }, overlay: true }, 'a:y': {} } }),
        );
        expect(componentsFromManifest(['a:x', 'a:y'], manifest)).toEqual([
            { type: 'a:x', defaultTransform: { w: 10, h: 20 }, overlay: true },
            { type: 'a:y' },
        ]);
        expect(componentsFromManifest(['a:x'], new TextEncoder().encode('not json'))).toEqual([{ type: 'a:x' }]);
        expect(componentsFromManifest(['a:x'], undefined)).toEqual([{ type: 'a:x' }]);
    });
});
