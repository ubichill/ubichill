import { describe, expect, it } from 'vitest';
import { surfacePlacement } from './CoreMediaSurface';

const transform = { x: 10, y: 20, z: 3, w: 640, h: 360, scale: 1, rotation: 0 };

describe('surfacePlacement', () => {
    it('ワールド座標では左上からの位置と大きさをそのまま使う', () => {
        expect(surfacePlacement({ transform })).toMatchObject({
            left: 10,
            top: 20,
            width: 640,
            height: 360,
            zIndex: 3,
        });
    });

    it('overlay の角を基準にする（右下なら right / bottom）', () => {
        const style = surfacePlacement({ transform, overlay: 'bottom-right' });
        expect(style).toMatchObject({ right: 10, bottom: 20 });
        expect(style).not.toHaveProperty('left');
        expect(style).not.toHaveProperty('top');
    });

    it('fill は画面全体を覆い、x/y/w/h を使わない', () => {
        expect(surfacePlacement({ transform, overlay: 'fill' })).toEqual({ position: 'absolute', inset: 0, zIndex: 3 });
    });

    it('大きさが 0 なら幅・高さを指定しない（中身の大きさに任せる）、z が 0 なら zIndex を付けない', () => {
        const style = surfacePlacement({ transform: { ...transform, w: 0, h: 0, z: 0 } });
        expect(style.width).toBeUndefined();
        expect(style.height).toBeUndefined();
        expect(style.zIndex).toBeUndefined();
    });
});
