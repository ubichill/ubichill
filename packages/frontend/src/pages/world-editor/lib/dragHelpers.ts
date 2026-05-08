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

/**
 * ドラッグ開始情報と移動量から、エンティティの transform 差分を返す。
 */
export function applyDrag(drag: DragState, dx: number, dy: number): Partial<InitialEntity['transform']> {
    const { startTransform: s, mode } = drag;
    if (mode === 'move') {
        return { x: Math.round(s.x + dx), y: Math.round(s.y + dy) };
    }
    let x = s.x;
    let y = s.y;
    let w = s.w;
    let h = s.h;
    if (mode === 'resize-se') {
        w = Math.max(MIN_SIZE, Math.round(s.w + dx));
        h = Math.max(MIN_SIZE, Math.round(s.h + dy));
    } else if (mode === 'resize-sw') {
        w = Math.max(MIN_SIZE, Math.round(s.w - dx));
        h = Math.max(MIN_SIZE, Math.round(s.h + dy));
        x = Math.round(s.x + (s.w - w));
    } else if (mode === 'resize-ne') {
        w = Math.max(MIN_SIZE, Math.round(s.w + dx));
        h = Math.max(MIN_SIZE, Math.round(s.h - dy));
        y = Math.round(s.y + (s.h - h));
    } else if (mode === 'resize-nw') {
        w = Math.max(MIN_SIZE, Math.round(s.w - dx));
        h = Math.max(MIN_SIZE, Math.round(s.h - dy));
        x = Math.round(s.x + (s.w - w));
        y = Math.round(s.y + (s.h - h));
    }
    return { x, y, w, h };
}

/**
 * 既存のエンティティ群の z 値の最大 + 1 を返す。
 */
export function nextZ(entities: InitialEntity[]): number {
    const max = entities.reduce((m, e) => Math.max(m, e.transform.z ?? 0), 0);
    return max + 1;
}
