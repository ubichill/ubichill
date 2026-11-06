import type { CanvasStrokeData } from '@ubichill/shared';

export interface StrokeStyle {
    composite: GlobalCompositeOperation;
    color: string;
}

/**
 * ストロークを Canvas に重ねる方法（純粋）。
 *
 * 消しゴム（mode: 'erase'）は「描いた線を透明で上書きする」ので destination-out で合成する。
 * destination-out は色を使わずアルファだけを見るため、mod が渡した color（古い Host 向けの透明）は使わず不透明で塗る。
 * 永続レイヤーには線しか無いので、背景（ワールドの床）は消えない。
 * 知らない mode は描く線として扱う（新しい mod が未知の値を送っても、消す方向には倒さない）。
 */
export function strokeStyle(stroke: Pick<CanvasStrokeData, 'mode' | 'color'>): StrokeStyle {
    return stroke.mode === 'erase'
        ? { composite: 'destination-out', color: '#000' }
        : { composite: 'source-over', color: stroke.color };
}
