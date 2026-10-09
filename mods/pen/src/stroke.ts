/**
 * ストロークの組み立てと照合（純関数。`Ubi` に触れないので単体テストできる）。
 *
 * ペンと消しゴムは同じ pen:pen で、違いは data.eraser だけ。消しゴムも「消すストローク」として
 * 描いた線と同じ経路（commit / broadcast / pen:stroke Entity）に載せるので、順に重ねれば
 * 後から入った人の画面でも同じ絵になる。
 */

import type { CanvasStrokeData } from 'ubichill';

export type StrokePoint = [x: number, y: number, pressure: number];

export interface PenTool {
    color: string;
    strokeWidth: number;
    eraser: boolean;
}

/** 消しゴムはペンと同じ太さの選択肢を使うが、線より太くないと消しにくいのでこの倍率で広げる。 */
export const ERASER_SIZE_SCALE = 4;

/** 点が 1 つ以下ならストロークにならない（クリックしただけ）。 */
export function buildStroke(points: readonly StrokePoint[], tool: PenTool): CanvasStrokeData | null {
    if (points.length <= 1) return null;
    return tool.eraser
        ? { points: points.slice(), color: '#000000', size: tool.strokeWidth * ERASER_SIZE_SCALE, mode: 'erase' }
        : { points: points.slice(), color: tool.color, size: tool.strokeWidth };
}

/**
 * 同じストロークを二重に描かないための指紋。自分のストロークは即時に描いたあと、
 * broadcast と Entity でも届くので、これで照合して捨てる。
 * 消しゴムと線は同じ座標を通りうるので、mode を含めないと消すストロークを線と取り違えて捨てる。
 */
export function strokeFingerprint(data: CanvasStrokeData): string {
    const p0 = data.points[0];
    const last = data.points[data.points.length - 1];
    return [
        data.mode ?? 'draw',
        data.color,
        data.size,
        data.points.length,
        `${p0?.[0] ?? 0},${p0?.[1] ?? 0}`,
        `${last?.[0] ?? 0},${last?.[1] ?? 0}`,
    ].join('|');
}
