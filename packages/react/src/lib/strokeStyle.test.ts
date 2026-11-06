import type { CanvasStrokeData } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import { strokeStyle } from './strokeStyle';

describe('strokeStyle', () => {
    it('mode 省略（古い mod）は mod の色でそのまま描く', () => {
        expect(strokeStyle({ color: '#ff0000' })).toEqual({ composite: 'source-over', color: '#ff0000' });
    });

    it('draw は mod の色でそのまま描く', () => {
        expect(strokeStyle({ color: '#00ff00', mode: 'draw' })).toEqual({ composite: 'source-over', color: '#00ff00' });
    });

    it('erase は destination-out で、透明な color が渡っても不透明で塗る（透明だと何も消えない）', () => {
        expect(strokeStyle({ color: 'rgba(0,0,0,0)', mode: 'erase' })).toEqual({
            composite: 'destination-out',
            color: '#000',
        });
    });

    it('未知の mode は消す方向に倒さず、描く線として扱う', () => {
        const unknown = { color: '#123456', mode: 'blur' } as unknown as CanvasStrokeData;
        expect(strokeStyle(unknown)).toEqual({ composite: 'source-over', color: '#123456' });
    });
});
