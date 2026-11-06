/**
 * ストロークの組み立てと検証（純関数。`Ubi` に触れないので単体テストできる）。
 *
 * ペンと消しゴムは同じ pen:pen で、違いは data.eraser だけ。消しゴムも「消すストローク」として
 * 描いた線と同じ経路（commit / pen:stroke Entity）に載せるので、順に重ねれば
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

/** pen:pen の strokeWidth の上限。pen.worker.tsx の dataFields の max と揃える（config はリテラルしか書けない）。 */
export const MAX_STROKE_WIDTH = 30;

/**
 * 1 本のストロークの太さの上限（消しゴムの最大）。改造したクライアントが太さ 1e6 の消すストロークを 1 本置くだけで
 * 全員のキャンバスを消せないよう、受け取る側でもこれに丸める。
 */
export const MAX_STROKE_SIZE = MAX_STROKE_WIDTH * ERASER_SIZE_SCALE;

/**
 * 1 本のストロークの点の上限。長く描いた線はここで区切って次のストロークに続ける。
 * pen:stroke 1 つの送信がインスタンスの上限（1 回 64 KiB）に収まる数にしてある。
 */
export const MAX_STROKE_POINTS = 1000;

const MAX_COLOR_LENGTH = 64;

/**
 * 消すストロークの color。mode を知らない古い Host（プロトコル v5 以前）は color で上書き描画するので、
 * 透明にして「何も起きない」に留める（黒い太線にしない）。新しい Host は erase のとき color を使わない。
 */
export const ERASER_FALLBACK_COLOR = 'rgba(0,0,0,0)';

const clampSize = (size: number): number => Math.min(size, MAX_STROKE_SIZE);

/** 点が 1 つ以下ならストロークにならない（クリックしただけ）。 */
export function buildStroke(points: readonly StrokePoint[], tool: PenTool): CanvasStrokeData | null {
    if (points.length <= 1) return null;
    return tool.eraser
        ? {
              points: points.slice(),
              color: ERASER_FALLBACK_COLOR,
              size: clampSize(tool.strokeWidth * ERASER_SIZE_SCALE),
              mode: 'erase',
          }
        : { points: points.slice(), color: tool.color, size: clampSize(tool.strokeWidth) };
}

/**
 * 描いている線に点を足す。点が上限に達したら、そこまでを 1 本（`full`）として切り出し、
 * 続きはその最後の点から始める（線は途切れない）。
 */
export function extendStroke(
    points: readonly StrokePoint[],
    point: StrokePoint,
): { points: StrokePoint[]; full: StrokePoint[] | null } {
    const next = [...points, point];
    return next.length < MAX_STROKE_POINTS ? { points: next, full: null } : { points: [point], full: next };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

function parsePoint(value: unknown): StrokePoint | null {
    if (!Array.isArray(value) || value.length !== 3) return null;
    const [x, y, pressure] = value;
    return isFiniteNumber(x) && isFiniteNumber(y) && isFiniteNumber(pressure) ? [x, y, pressure] : null;
}

/**
 * 他人から届いたストローク（pen:stroke の data）を検証し、描いてよい形に直す。描けないものは null。
 * 受け取るデータは改造したクライアントが書けるので、canvas はこれを通したものだけを描く
 * （不正な 1 本で tick 全体を落とさない・太すぎる消しゴムで全員の絵を消させない）。
 */
export function parseStroke(value: unknown): CanvasStrokeData | null {
    if (!isRecord(value)) return null;
    const { points, color, size, mode } = value;
    if (!Array.isArray(points) || points.length < 2 || points.length > MAX_STROKE_POINTS) return null;
    if (typeof color !== 'string' || color.length === 0 || color.length > MAX_COLOR_LENGTH) return null;
    if (!isFiniteNumber(size) || size <= 0) return null;
    if (mode !== undefined && mode !== 'draw' && mode !== 'erase') return null;
    const parsed = points.map(parsePoint);
    if (parsed.some((p) => p === null)) return null;
    return {
        points: parsed as StrokePoint[],
        color,
        size: clampSize(size),
        ...(mode === undefined ? {} : { mode }),
    };
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
