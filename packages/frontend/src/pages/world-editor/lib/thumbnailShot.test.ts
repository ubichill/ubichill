import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    missingImagesNotice,
    moveFrame,
    shotScale,
    THUMBNAIL_HEIGHT,
    THUMBNAIL_WIDTH,
    thumbnailFrame,
    withTimeout,
} from './thumbnailShot';

const NO_INSETS = { top: 0, right: 0, bottom: 0, left: 0 };

describe('thumbnailFrame', () => {
    it('横に長い画面では高さに合わせ、左右の真ん中に置く', () => {
        expect(thumbnailFrame({ width: 2000, height: 720 }, NO_INSETS)).toEqual({
            x: 360,
            y: 0,
            width: 1280,
            height: 720,
        });
    });

    it('縦に長い画面では幅に合わせ、上下の真ん中に置く', () => {
        expect(thumbnailFrame({ width: 320, height: 800 }, NO_INSETS)).toEqual({
            x: 0,
            y: 310,
            width: 320,
            height: 180,
        });
    });

    it('insets を除いた残りの真ん中に置く（下の操作の帯に掛からない）', () => {
        const frame = thumbnailFrame({ width: 1000, height: 700 }, { top: 20, right: 20, bottom: 100, left: 20 });
        expect(frame).not.toBeNull();
        if (!frame) return;
        expect(frame.x).toBeGreaterThanOrEqual(20);
        expect(frame.y).toBeGreaterThanOrEqual(20);
        expect(frame.x + frame.width).toBeLessThanOrEqual(980);
        expect(frame.y + frame.height).toBeLessThanOrEqual(600);
        expect(frame.width).toBe(960);
    });

    it('16:9 を保ち、半端な px を出さない', () => {
        const frame = thumbnailFrame({ width: 1001, height: 777 }, { top: 7, right: 3, bottom: 61, left: 5 });
        expect(frame).not.toBeNull();
        if (!frame) return;
        for (const value of Object.values(frame)) expect(Number.isInteger(value)).toBe(true);
        expect(Math.abs(frame.width / frame.height - THUMBNAIL_WIDTH / THUMBNAIL_HEIGHT)).toBeLessThan(0.01);
    });

    it('insets で場所が残らない・まだ測れていない（0）なら null', () => {
        expect(thumbnailFrame({ width: 0, height: 0 }, NO_INSETS)).toBeNull();
        expect(thumbnailFrame({ width: 100, height: 100 }, { top: 50, right: 0, bottom: 50, left: 0 })).toBeNull();
    });
});

describe('shotScale', () => {
    it('枠の幅がサムネイルの幅になる倍率（小さい枠ほど細かく描き直す）', () => {
        expect(shotScale({ x: 0, y: 0, width: 640, height: 360 })).toBe(2);
        expect(shotScale({ x: 0, y: 0, width: THUMBNAIL_WIDTH, height: THUMBNAIL_HEIGHT })).toBe(1);
    });
});

describe('moveFrame', () => {
    it('枠を出す層と撮る要素がずれていれば、その差だけ動かす', () => {
        const frame = { x: 10, y: 20, width: 160, height: 90 };
        expect(moveFrame(frame, { left: 100, top: 50 }, { left: 90, top: 60 })).toEqual({
            x: 20,
            y: 10,
            width: 160,
            height: 90,
        });
    });
});

describe('missingImagesNotice', () => {
    it('写せなかった画像があるときだけ知らせる', () => {
        expect(missingImagesNotice(0)).toBeNull();
        expect(missingImagesNotice(2)).toContain('2 枚');
    });
});

describe('withTimeout', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('間に合えばそのまま返す', async () => {
        await expect(withTimeout(Promise.resolve('ok'), 1000, '遅い')).resolves.toBe('ok');
    });

    it('間に合わなければ、渡した文で失敗する', async () => {
        vi.useFakeTimers();
        const never = new Promise<string>(() => {});
        const result = withTimeout(never, 1000, '時間がかかりすぎました');
        vi.advanceTimersByTime(1000);
        await expect(result).rejects.toThrow('時間がかかりすぎました');
    });

    it('元の失敗はそのまま返す', async () => {
        await expect(withTimeout(Promise.reject(new Error('壊れた')), 1000, '遅い')).rejects.toThrow('壊れた');
    });
});
