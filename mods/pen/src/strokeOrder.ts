/**
 * キャンバスに重ねるストロークの順番（純関数。`Ubi` に触れないので単体テストできる）。
 *
 * 消しゴムはピクセルを消すので、重ねる順で絵が変わる。正しい順は pen:stroke の Entity が届いた順
 * （サーバーが決めた順で、後から入った人もこの順で受け取る）。ただし自分の線は保存を待たずに描くので、
 * その間に他人の線が先に確定すると、自分の画面だけ順番が違ってしまう。
 * そこで画面の順を「確定した順（confirmed）+ まだ届いていない自分の線（pending）」に保ち、
 * 届いた順がこれと食い違ったとき・保存に失敗したときだけ全体を描き直す。
 */

import type { CanvasStrokeData } from 'ubichill';

/** 自分が描いて、まだ pen:stroke として届いていない 1 本。strokeId は Entity の data に入れて照合する。 */
export interface PendingStroke {
    readonly strokeId: string;
    readonly stroke: CanvasStrokeData;
}

export interface StrokeOrder {
    /** Entity が届いた順。 */
    readonly confirmed: readonly CanvasStrokeData[];
    /** 自分が描いた順。 */
    readonly pending: readonly PendingStroke[];
}

/** キャンバス（Host の永続レイヤー）に対してすること。 */
export type CanvasUpdate =
    | { readonly kind: 'none' }
    | { readonly kind: 'append'; readonly stroke: CanvasStrokeData }
    | { readonly kind: 'redraw'; readonly strokes: readonly CanvasStrokeData[] };

export interface StrokeOrderStep {
    readonly order: StrokeOrder;
    readonly update: CanvasUpdate;
}

export const EMPTY_STROKE_ORDER: StrokeOrder = { confirmed: [], pending: [] };

const NONE: CanvasUpdate = { kind: 'none' };

/** 画面に重なっている順。 */
export function strokesInOrder(order: StrokeOrder): CanvasStrokeData[] {
    return [...order.confirmed, ...order.pending.map((p) => p.stroke)];
}

/** 同じ線か（Host に重ねた自分の線と、届いた data が同じなら描き直さなくてよい）。 */
export function sameStroke(x: CanvasStrokeData, y: CanvasStrokeData): boolean {
    return (
        (x.mode ?? 'draw') === (y.mode ?? 'draw') &&
        x.color === y.color &&
        x.size === y.size &&
        x.points.length === y.points.length &&
        x.points.every((p, i) => {
            const q = y.points[i];
            return q !== undefined && p[0] === q[0] && p[1] === q[1] && p[2] === q[2];
        })
    );
}

const redraw = (order: StrokeOrder): StrokeOrderStep => ({
    order,
    update: { kind: 'redraw', strokes: strokesInOrder(order) },
});

/** 自分の線を描いた。保存を待たずに一番上へ重ねる。 */
export function drawPending(order: StrokeOrder, pending: PendingStroke): StrokeOrderStep {
    return {
        order: { ...order, pending: [...order.pending, pending] },
        update: { kind: 'append', stroke: pending.stroke },
    };
}

/**
 * pen:stroke が届いた。`strokeId` が自分の pending の先頭で中身も同じなら、画面の順は既に正しいので何もしない。
 * 他人の線（または自分の後の線）が先に確定したなら、確定した線は pending より下に入るので描き直す。
 * 画面に残すのは届いた data（後から入った人が見るもの）で、自分が描いたものではない。
 */
export function confirmStroke(
    order: StrokeOrder,
    stroke: CanvasStrokeData,
    strokeId: string | undefined,
): StrokeOrderStep {
    const index = strokeId === undefined ? -1 : order.pending.findIndex((p) => p.strokeId === strokeId);
    const next: StrokeOrder = {
        confirmed: [...order.confirmed, stroke],
        pending: index === -1 ? order.pending : order.pending.filter((_, i) => i !== index),
    };
    const head = order.pending[0];
    if (index === 0 && head && sameStroke(head.stroke, stroke)) return { order: next, update: NONE };
    if (index === -1 && order.pending.length === 0) return { order: next, update: { kind: 'append', stroke } };
    return redraw(next);
}

/** 自分の線の保存に失敗した。誰の画面にも、後から入った人にも残らないので、自分の画面からも消す。 */
export function dropPending(order: StrokeOrder, strokeId: string): StrokeOrderStep {
    if (!order.pending.some((p) => p.strokeId === strokeId)) return { order, update: NONE };
    return redraw({ ...order, pending: order.pending.filter((p) => p.strokeId !== strokeId) });
}
