import { ROOM_PORTAL } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import {
    initialPlacement,
    isTap,
    type KeyLike,
    movedByKey,
    nextFocusIndex,
    PLACEMENT_STEP,
    PLACEMENT_TAP_SLOP,
    placementAt,
    placementKeyAction,
    pointerToWorld,
    revealScroll,
    type WorldViewport,
    worldToScreen,
} from './portalPlacement';

const WORLD = { width: 2000, height: 1500 };
const VIEW: WorldViewport = { left: 0, top: 0, width: 1280, height: 720, scrollLeft: 300, scrollTop: 200, scale: 1 };

describe('pointerToWorld', () => {
    it('スクロールした分を足す', () => {
        expect(pointerToWorld({ x: 100, y: 50 }, VIEW)).toEqual({ x: 400, y: 250 });
    });

    it('スクロールする要素が画面の端からずれていれば、そのぶん引く', () => {
        expect(pointerToWorld({ x: 100, y: 50 }, { ...VIEW, left: 40, top: 20 })).toEqual({ x: 360, y: 230 });
    });

    it('拡大されていれば、画面の 1px はワールドでは小さい（スクロールはワールドの px のまま）', () => {
        expect(pointerToWorld({ x: 100, y: 50 }, { ...VIEW, scale: 2 })).toEqual({ x: 350, y: 225 });
    });

    it('worldToScreen と行って戻ると同じ', () => {
        const view = { ...VIEW, left: 13, top: 7, scale: 0.75 };
        const point = { x: 812, y: 333 };
        const back = pointerToWorld(worldToScreen(point, view), view);
        expect(back.x).toBeCloseTo(point.x);
        expect(back.y).toBeCloseTo(point.y);
    });
});

describe('placementAt', () => {
    it('ワールドの中はそのまま（整数にする）', () => {
        expect(placementAt({ x: 640.4, y: 400.6 }, WORLD)).toEqual({ x: 640, y: 401 });
    });

    it('角の外はポータルがはみ出さない所まで寄せる', () => {
        expect(placementAt({ x: -50, y: 99_999 }, WORLD)).toEqual({
            x: ROOM_PORTAL.WIDTH / 2,
            y: WORLD.height - ROOM_PORTAL.HEIGHT / 2,
        });
    });

    it('ワールドがポータルより小さければ真ん中', () => {
        expect(placementAt({ x: 0, y: 0 }, { width: 120, height: 100 })).toEqual({ x: 60, y: 50 });
    });
});

describe('initialPlacement', () => {
    it('見ている所の真ん中', () => {
        expect(initialPlacement(VIEW, WORLD)).toEqual({ x: 300 + 640, y: 200 + 360 });
    });

    it('ワールドより画面が大きい（スクロールしない）ときもワールドの中に置く', () => {
        const view = { ...VIEW, width: 1920, height: 1080, scrollLeft: 0, scrollTop: 0 };
        expect(initialPlacement(view, { width: 800, height: 600 })).toEqual({
            x: 800 - ROOM_PORTAL.WIDTH / 2,
            y: 600 - ROOM_PORTAL.HEIGHT / 2,
        });
    });
});

describe('movedByKey', () => {
    const at = { x: 1000, y: 700 };

    it('矢印キーで動かし、Shift で大きく動かす', () => {
        expect(movedByKey(at, 'ArrowLeft', false, WORLD)).toEqual({ x: 1000 - PLACEMENT_STEP.NORMAL, y: 700 });
        expect(movedByKey(at, 'ArrowDown', true, WORLD)).toEqual({ x: 1000, y: 700 + PLACEMENT_STEP.LARGE });
    });

    it('矢印キーでなければ動かさない', () => {
        expect(movedByKey(at, 'Enter', false, WORLD)).toBeNull();
        expect(movedByKey(at, 'a', true, WORLD)).toBeNull();
        expect(movedByKey(at, 'arrowleft', false, WORLD)).toBeNull();
    });

    it('端でキーを押し続けてもワールドの外に出ない', () => {
        const corner = { x: ROOM_PORTAL.WIDTH / 2, y: ROOM_PORTAL.HEIGHT / 2 };
        expect(movedByKey(corner, 'ArrowLeft', true, WORLD)).toEqual(corner);
        expect(movedByKey(corner, 'ArrowUp', false, WORLD)).toEqual(corner);
    });
});

describe('isTap', () => {
    it('少しのぶれはクリック・タップ', () => {
        expect(isTap({ x: 10, y: 10 }, { x: 10, y: 10 })).toBe(true);
        expect(isTap({ x: 10, y: 10 }, { x: 15, y: 14 })).toBe(true);
    });

    it('しきいの長さちょうどからは動かしただけ', () => {
        expect(isTap({ x: 0, y: 0 }, { x: PLACEMENT_TAP_SLOP, y: 0 })).toBe(false);
        expect(isTap({ x: 0, y: 0 }, { x: 6, y: 6 })).toBe(false);
    });
});

describe('revealScroll', () => {
    it('見える範囲に収まっていれば動かさない', () => {
        expect(revealScroll({ x: 940, y: 560 }, VIEW)).toBeNull();
    });

    it('右に出たら右の端に合わせる・上に出たら上の端に合わせる', () => {
        expect(revealScroll({ x: 300 + 1280, y: 200 + 50 }, VIEW)).toEqual({
            left: 300 + ROOM_PORTAL.WIDTH / 2,
            top: 200 + 50 - ROOM_PORTAL.HEIGHT / 2,
        });
    });

    it('少しでも欠けたら追いかける', () => {
        expect(revealScroll({ x: 300 + ROOM_PORTAL.WIDTH / 2 - 1, y: 560 }, VIEW)).toEqual({ left: 299, top: 200 });
    });

    it('見える範囲がポータルより狭い向きは真ん中に合わせる', () => {
        const narrow = { ...VIEW, width: 150 };
        expect(revealScroll({ x: 1000, y: 560 }, narrow)).toEqual({ left: 1000 - 75, top: 200 });
        expect(revealScroll({ x: 1000, y: 560 }, { ...narrow, scrollLeft: 925 })).toBeNull();
    });
});

describe('placementKeyAction', () => {
    const key = (k: string, mods: Partial<Omit<KeyLike, 'key'>> = {}): KeyLike => ({
        key: k,
        shiftKey: false,
        ctrlKey: false,
        altKey: false,
        metaKey: false,
        ...mods,
    });

    it('Esc はボタンにフォーカスがあってもやめる', () => {
        expect(placementKeyAction(key('Escape'), false)).toBe('cancel');
        expect(placementKeyAction(key('Escape'), true)).toBe('cancel');
    });

    it('Enter は置く。ボタンの上ではそのボタンを押す', () => {
        expect(placementKeyAction(key('Enter'), false)).toBe('place');
        expect(placementKeyAction(key('Enter'), true)).toBe('button');
        expect(placementKeyAction(key(' '), true)).toBe('button');
        expect(placementKeyAction(key(' '), false)).toBe('swallow');
    });

    it('矢印キーは Shift を押していても動かす', () => {
        expect(placementKeyAction(key('ArrowUp'), false)).toBe('move');
        expect(placementKeyAction(key('ArrowLeft', { shiftKey: true }), true)).toBe('move');
    });

    it('Tab は置く画面の中で回す', () => {
        expect(placementKeyAction(key('Tab'), false)).toBe('focus-next');
        expect(placementKeyAction(key('Tab', { shiftKey: true }), true)).toBe('focus-previous');
    });

    it('ほかのキー（mod の操作に使う Z・WASD・Shift だけ）は mod に渡さない', () => {
        for (const k of ['z', 'Z', 'w', 'a', 's', 'd', 'Shift', 'F5'])
            expect(placementKeyAction(key(k, { shiftKey: k === 'Z' || k === 'Shift' }), false)).toBe('swallow');
    });

    it('Ctrl・Alt・Meta との組み合わせはブラウザ・OS に任せる（Esc・Enter・矢印でも置く画面では扱わない）', () => {
        expect(placementKeyAction(key('r', { metaKey: true }), false)).toBe('pass');
        expect(placementKeyAction(key('Escape', { ctrlKey: true }), false)).toBe('pass');
        expect(placementKeyAction(key('ArrowLeft', { altKey: true }), false)).toBe('pass');
        expect(placementKeyAction(key('Tab', { ctrlKey: true }), false)).toBe('pass');
    });
});

describe('nextFocusIndex', () => {
    it('置く画面そのもの（-1）からは最初・最後へ', () => {
        expect(nextFocusIndex(-1, 2, false)).toBe(0);
        expect(nextFocusIndex(-1, 2, true)).toBe(1);
    });

    it('端で反対の端に回る', () => {
        expect(nextFocusIndex(1, 2, false)).toBe(0);
        expect(nextFocusIndex(0, 2, true)).toBe(1);
        expect(nextFocusIndex(0, 1, false)).toBe(0);
    });

    it('押せるボタンが無ければ置く画面そのもの', () => {
        expect(nextFocusIndex(0, 0, false)).toBe(-1);
        expect(nextFocusIndex(-1, 0, true)).toBe(-1);
    });

    it('範囲の外（消えたボタン）からは最初・最後へ', () => {
        expect(nextFocusIndex(5, 2, false)).toBe(0);
        expect(nextFocusIndex(5, 2, true)).toBe(1);
    });
});
