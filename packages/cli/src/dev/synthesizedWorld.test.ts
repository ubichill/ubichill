import { definitionToResolved, WorldSourceKind } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import { synthesizeWorld } from './synthesizedWorld.ts';

describe('synthesizeWorld', () => {
    it('各 mod の Component を 1 つずつ置いた、スキーマを通る定義を作る', () => {
        const raw = synthesizeWorld([
            { id: 'pen', components: ['pen:pen', 'pen:tray', 'pen:canvas'] },
            { id: 'danmaku', components: ['danmaku:wall'] },
        ]);
        const url = 'file:///dev/world.yaml';
        const world = definitionToResolved(raw, url, { kind: WorldSourceKind.Local, url });
        expect(world.initialEntities.map((e) => e.components[0]?.type)).toEqual([
            'pen:pen',
            'pen:tray',
            'pen:canvas',
            'danmaku:wall',
        ]);
        expect(world.dependencies?.map((d) => d.name)).toEqual(['pen', 'danmaku']);
        const positions = new Set(world.initialEntities.map((e) => `${e.transform.x},${e.transform.y}`));
        expect(positions.size).toBe(4);
        for (const e of world.initialEntities) {
            expect(e.transform.x).toBeGreaterThan(0);
            expect(e.transform.x).toBeLessThan(2000);
            expect(e.transform.y).toBeGreaterThan(0);
            expect(e.transform.y).toBeLessThan(1500);
        }
    });

    it('mod が無くても空のワールドになる', () => {
        const raw = synthesizeWorld([]);
        const url = 'file:///dev/world.yaml';
        expect(definitionToResolved(raw, url, { kind: WorldSourceKind.Local, url }).initialEntities).toEqual([]);
    });
});
