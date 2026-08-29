import { describe, expect, it } from 'vitest';
import { OVERLAY_ANCHORS, OVERLAY_FILL, OVERLAY_MODES, resolveOverlayMode } from './entities';

describe('resolveOverlayMode', () => {
    it('未指定 / false は画面固定しない', () => {
        expect(resolveOverlayMode(undefined)).toBeNull();
        expect(resolveOverlayMode(false)).toBeNull();
    });

    // 真偽値だけだった頃の world.yaml / manifest がそのまま動く必要がある。
    it('true は top-left として扱う（旧 boolean 指定の互換）', () => {
        expect(resolveOverlayMode(true)).toBe('top-left');
    });

    it('角の指定はそのまま返す', () => {
        for (const anchor of OVERLAY_ANCHORS) {
            expect(resolveOverlayMode(anchor)).toBe(anchor);
        }
    });

    it("'fill' はそのまま返す（画面全体レイヤー）", () => {
        expect(resolveOverlayMode(OVERLAY_FILL)).toBe('fill');
    });

    it('OVERLAY_MODES は角 4 種 + fill を網羅する', () => {
        expect([...OVERLAY_MODES]).toEqual(['top-left', 'top-right', 'bottom-left', 'bottom-right', 'fill']);
    });
});
