import { describe, expect, it } from 'vitest';
import { enemySpecOf } from './enemy';
import {
    ageEffects,
    circlePath,
    EFFECT_SECONDS,
    impactEffects,
    type Scene,
    sceneCursors,
    shipEffects,
    withAlpha,
} from './render';

const area = { x: 0, y: 0, w: 800, h: 600 };
const empty: Scene = { area, clock: 0, enemies: [], bullets: [], shots: [], effects: [], hitbox: null };
const bullet = (x: number, y: number, color: string) => ({ x, y, from: { x, y }, color, enemyId: 'e' });

describe('sceneCursors', () => {
    const BACKGROUND = 4; // 星 3 層と範囲の枠

    it('何もなければ背景（星と範囲の枠）だけを描く', () => {
        expect(sceneCursors(empty)).toHaveLength(BACKGROUND);
    });

    it('星は範囲の中だけに描く（時刻が大きくても外へ流れ出ない）', () => {
        const small = { x: 100, y: 200, w: 50, h: 40 };
        const stars = sceneCursors({ ...empty, area: small, clock: 1.7e9 }).slice(0, 3);
        const numbers = stars.flatMap((c) =>
            (c.pathFills ?? []).flatMap((f) => [...f.d.matchAll(/M(-?[\d.]+) (-?[\d.]+)/g)]),
        );
        expect(numbers.length).toBeGreaterThan(0);
        for (const [, x, y] of numbers) {
            expect(Number(x)).toBeGreaterThanOrEqual(100);
            expect(Number(x)).toBeLessThanOrEqual(150);
            expect(Number(y)).toBeGreaterThanOrEqual(200);
            expect(Number(y)).toBeLessThanOrEqual(240);
        }
    });

    it('弾は色ごとに 1 つにまとめ、白い芯は全部で 1 つ（数百発でも送るカーソルは数個）', () => {
        const bullets = [
            ...Array.from({ length: 300 }, (_, i) => bullet(i, 10, '#ff0000')),
            ...Array.from({ length: 300 }, (_, i) => bullet(i, 20, '#00ff00')),
        ];
        const cursors = sceneCursors({ ...empty, bullets });
        expect(cursors).toHaveLength(BACKGROUND + 2 + 1);
    });

    it('どの敵の形・回転でも、パスに NaN・Infinity が入らない', () => {
        const enemies = (['radial', 'spiral', 'aimed', 'rain'] as const).map((pattern) => ({
            spec: enemySpecOf({ id: pattern, transform: { x: 0, y: 0, w: 40, h: 40 }, data: { pattern } }),
            position: { x: 100, y: 100 },
            hpRatio: 1.5,
            flash: true,
        }));
        const text = JSON.stringify(
            sceneCursors({
                ...empty,
                clock: 1e9,
                enemies,
                effects: impactEffects([{ x: 1, y: 2 }], [{ spec: enemies[0].spec, position: { x: 3, y: 4 } }]),
                hitbox: { center: { x: 5, y: 5 }, radius: 4 },
            }),
        );
        expect(text).not.toMatch(/NaN|Infinity/);
    });

    it('当たり判定の点は自分が乗っているときだけ描く', () => {
        expect(sceneCursors({ ...empty, hitbox: null })).toHaveLength(BACKGROUND);
        expect(sceneCursors({ ...empty, hitbox: { center: { x: 5, y: 5 }, radius: 4 } })).toHaveLength(BACKGROUND + 1);
    });
});

describe('描画の部品', () => {
    it('円のパスは中心から半径の位置で始まる', () => {
        expect(circlePath(10, 20, 5)).toBe('M5 20a5 5 0 1 0 10 0a5 5 0 1 0 -10 0Z');
    });

    it('透明度は 0〜1 に収め、#rgb も読める', () => {
        expect(withAlpha('#abc', 0.5)).toBe('rgba(170, 187, 204, 0.5)');
        expect(withAlpha('#ff0000', 2)).toBe('rgba(255, 0, 0, 1)');
        expect(withAlpha('#ff0000', -1)).toBe('rgba(255, 0, 0, 0)');
    });

    it('演出は決めた時間で消え、大きな経過時間でも一気に消えすぎない', () => {
        const spark = { kind: 'spark' as const, x: 0, y: 0, color: '#fff', age: 0 };
        const burst = { ...spark, kind: 'burst' as const };
        expect(ageEffects(ageEffects([spark, burst], 0.1), EFFECT_SECONDS.spark - 0.1)).toEqual([
            { ...burst, age: EFFECT_SECONDS.spark },
        ]);
        expect(ageEffects([burst], 60)).toHaveLength(1);
        expect(ageEffects([burst], Number.NaN)).toEqual([burst]);
    });
});

describe('shipEffects', () => {
    const at = { x: 10, y: 20 };
    const calm = { hitAt: 0, downAt: 0 };

    it('被弾・撃墜・復活でそれぞれ演出を出し、変わらなければ出さない', () => {
        expect(shipEffects(calm, { hitAt: 5, downAt: 0 }, at).map((e) => e.kind)).toEqual(['burst']);
        expect(shipEffects({ hitAt: 5, downAt: 0 }, { hitAt: 9, downAt: 9 }, at).map((e) => e.kind)).toEqual(['blast']);
        const respawn = shipEffects({ hitAt: 9, downAt: 9 }, { hitAt: 12, downAt: 0 }, at);
        expect(respawn).toHaveLength(1);
        expect(respawn[0].color).not.toBe(shipEffects(calm, { hitAt: 5, downAt: 0 }, at)[0].color);
        expect(shipEffects({ hitAt: 5, downAt: 0 }, { hitAt: 5, downAt: 0 }, at)).toEqual([]);
    });

    it('初めて見た自機の昔の被弾は出さない（後から部屋に入った人に古い爆発を見せない）', () => {
        expect(shipEffects(undefined, { hitAt: 5, downAt: 5 }, at)).toEqual([]);
    });
});
