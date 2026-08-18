import { describe, expect, it } from 'vitest';
import { integrateKeyboardMovement } from './useKeyboardMovement';

const WORLD = { width: 2000, height: 1500 };

describe('integrateKeyboardMovement', () => {
    it('押下キーが無ければ position を変えない(同一参照を返す)', () => {
        const current = { x: 100, y: 100 };
        expect(integrateKeyboardMovement(current, new Set(), WORLD, 1)).toBe(current);
    });

    it('ArrowRight で x が正方向に増える', () => {
        const next = integrateKeyboardMovement({ x: 100, y: 100 }, new Set(['ArrowRight']), WORLD, 1, 200);
        expect(next.x).toBe(300);
        expect(next.y).toBe(100);
    });

    it('斜め移動は正規化されて速度が変わらない', () => {
        const next = integrateKeyboardMovement({ x: 0, y: 0 }, new Set(['ArrowRight', 'ArrowDown']), WORLD, 1, 200);
        const dist = Math.hypot(next.x, next.y);
        expect(dist).toBeCloseTo(200, 5);
    });

    it('worldSize の範囲でクランプする(負の方向)', () => {
        const next = integrateKeyboardMovement({ x: 5, y: 5 }, new Set(['ArrowLeft', 'ArrowUp']), WORLD, 1, 200);
        expect(next.x).toBe(0);
        expect(next.y).toBe(0);
    });

    it('worldSize の範囲でクランプする(正の方向)', () => {
        const next = integrateKeyboardMovement(
            { x: WORLD.width - 5, y: WORLD.height - 5 },
            new Set(['ArrowRight', 'ArrowDown']),
            WORLD,
            1,
            200,
        );
        expect(next.x).toBe(WORLD.width);
        expect(next.y).toBe(WORLD.height);
    });

    it('相殺するキー(Left+Right)は移動しない', () => {
        const current = { x: 100, y: 100 };
        expect(integrateKeyboardMovement(current, new Set(['ArrowLeft', 'ArrowRight']), WORLD, 1)).toBe(current);
    });
});
