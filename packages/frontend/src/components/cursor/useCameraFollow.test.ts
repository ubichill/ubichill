import { describe, expect, it } from 'vitest';
import { computeCameraScroll } from './useCameraFollow';

const WORLD = { width: 2000, height: 1500 };
const VIEWPORT = { width: 800, height: 600 };

describe('computeCameraScroll', () => {
    it('ワールド中央付近ではアバターがビューポート中央に来るようスクロールする', () => {
        const { scrollLeft, scrollTop } = computeCameraScroll({ x: 1000, y: 750 }, WORLD, VIEWPORT);
        expect(scrollLeft).toBe(1000 - VIEWPORT.width / 2);
        expect(scrollTop).toBe(750 - VIEWPORT.height / 2);
    });

    it('ワールド左上端に近いときは 0 でクランプする(負にならない)', () => {
        const { scrollLeft, scrollTop } = computeCameraScroll({ x: 10, y: 10 }, WORLD, VIEWPORT);
        expect(scrollLeft).toBe(0);
        expect(scrollTop).toBe(0);
    });

    it('ワールド右下端に近いときは worldSize-viewport でクランプする', () => {
        const { scrollLeft, scrollTop } = computeCameraScroll(
            { x: WORLD.width - 10, y: WORLD.height - 10 },
            WORLD,
            VIEWPORT,
        );
        expect(scrollLeft).toBe(WORLD.width - VIEWPORT.width);
        expect(scrollTop).toBe(WORLD.height - VIEWPORT.height);
    });

    it('worldSize がビューポートより小さい場合はスクロール範囲が 0 になる', () => {
        const { scrollLeft, scrollTop } = computeCameraScroll(
            { x: 100, y: 100 },
            { width: 400, height: 300 },
            VIEWPORT,
        );
        expect(scrollLeft).toBe(0);
        expect(scrollTop).toBe(0);
    });
});
