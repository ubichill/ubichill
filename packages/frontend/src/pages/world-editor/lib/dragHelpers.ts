import type { InitialEntity } from '@ubichill/shared';

export type DragMode = 'move' | 'resize-se' | 'resize-sw' | 'resize-ne' | 'resize-nw';

export interface DragState {
    index: number;
    mode: DragMode;
    startClient: { x: number; y: number };
    startTransform: { x: number; y: number; w: number; h: number };
}

export const DEFAULT_W = 200;
export const DEFAULT_H = 150;
export const MIN_SIZE = 20;

type Transform = { x: number; y: number; w: number; h: number };

/** リサイズ差分を方向ごとに 1 度の式で返す純粋関数。 */
function applyResize(s: Transform, dx: number, dy: number, mode: Exclude<DragMode, 'move'>): Transform {
    switch (mode) {
        case 'resize-se': {
            const w = Math.max(MIN_SIZE, Math.round(s.w + dx));
            const h = Math.max(MIN_SIZE, Math.round(s.h + dy));
            return { x: s.x, y: s.y, w, h };
        }
        case 'resize-sw': {
            const w = Math.max(MIN_SIZE, Math.round(s.w - dx));
            const h = Math.max(MIN_SIZE, Math.round(s.h + dy));
            return { x: Math.round(s.x + (s.w - w)), y: s.y, w, h };
        }
        case 'resize-ne': {
            const w = Math.max(MIN_SIZE, Math.round(s.w + dx));
            const h = Math.max(MIN_SIZE, Math.round(s.h - dy));
            return { x: s.x, y: Math.round(s.y + (s.h - h)), w, h };
        }
        case 'resize-nw': {
            const w = Math.max(MIN_SIZE, Math.round(s.w - dx));
            const h = Math.max(MIN_SIZE, Math.round(s.h - dy));
            return { x: Math.round(s.x + (s.w - w)), y: Math.round(s.y + (s.h - h)), w, h };
        }
    }
}

/** ドラッグ差分から transform patch を返す。`move` は位置のみ、`resize-*` は applyResize に委譲。 */
export function applyDrag(drag: DragState, dx: number, dy: number): Partial<InitialEntity['transform']> {
    const s = drag.startTransform;
    if (drag.mode === 'move') {
        return { x: Math.round(s.x + dx), y: Math.round(s.y + dy) };
    }
    return applyResize(s, dx, dy, drag.mode);
}
