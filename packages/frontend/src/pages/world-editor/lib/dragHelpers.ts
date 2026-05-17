import type { InitialEntity } from '@ubichill/shared';
import type { EntityPath } from './entityTree';

export type DragMode = 'move' | 'resize-se' | 'resize-sw' | 'resize-ne' | 'resize-nw';

export interface DragState {
    path: EntityPath;
    mode: DragMode;
    startClient: { x: number; y: number };
    startTransform: { x: number; y: number; w: number; h: number };
}

export const DEFAULT_W = 200;
export const DEFAULT_H = 150;
export const MIN_SIZE = 20;
export const SNAP_STEP = 10;

/** 値をグリッドに丸める純関数 (step <= 0 ならそのまま)。 */
export const snap = (value: number, step: number): number => (step > 0 ? Math.round(value / step) * step : value);

/** 値を min/max にクランプする純関数。 */
export const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

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

export interface DragOptions {
    /** > 0 ならグリッド単位 (px) で丸める。 */
    snapStep?: number;
    /** 指定があれば transform を範囲内に clamp する。 */
    worldSize?: { width: number; height: number };
}

/**
 * ドラッグ差分から transform patch を返す。
 * `snapStep === 0` (デフォルト) のときは grid snap も worldSize clamp も無効 (自由)。
 */
export function applyDrag(
    drag: DragState,
    dx: number,
    dy: number,
    opts: DragOptions = {},
): Partial<InitialEntity['transform']> {
    const s = drag.startTransform;
    const step = opts.snapStep ?? 0;
    // snap が無効なら worldSize による clamp も無視する (= 自由配置)
    const ws = step > 0 ? opts.worldSize : undefined;

    if (drag.mode === 'move') {
        const x = snap(s.x + dx, step);
        const y = snap(s.y + dy, step);
        return ws
            ? {
                  x: clamp(x, 0, Math.max(0, ws.width - (s.w || MIN_SIZE))),
                  y: clamp(y, 0, Math.max(0, ws.height - (s.h || MIN_SIZE))),
              }
            : { x, y };
    }
    const next = applyResize(s, dx, dy, drag.mode);
    const w = snap(next.w, step);
    const h = snap(next.h, step);
    if (!ws) return { ...next, w, h };
    const maxW = Math.max(MIN_SIZE, ws.width);
    const maxH = Math.max(MIN_SIZE, ws.height);
    return { ...next, w: clamp(w, MIN_SIZE, maxW), h: clamp(h, MIN_SIZE, maxH) };
}
