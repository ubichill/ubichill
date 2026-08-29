/**
 * トレイに戻すときの置き場所の計算（純関数。`Ubi` に触れないので単体テストできる）。
 */

import { PEN_BOX } from './penTip';

export interface Rect {
    x: number;
    y: number;
    w: number;
    h: number;
}

export interface Point {
    x: number;
    y: number;
}

/**
 * トレイ内のクリック位置を、ペンの transform (左上基準) に直す。
 *
 * 押した点がペンの中心に来るようにし、ペン全体がトレイの矩形に収まるよう内側へ丸める。
 * トレイ原点へ吸着させないことで「置いた場所に置かれる」挙動になる。
 *
 * @param tray  トレイの矩形（ペンと同じ座標系）
 * @param local トレイ左上を原点とするクリック位置
 */
export function dropPointInTray(tray: Rect, local: Point, pen: { w: number; h: number } = PEN_BOX): Point {
    const clamp = (v: number, size: number, limit: number): number => {
        // ペンがトレイより大きい場合は原点寄せに倒す（負の位置へ飛ばさない）
        const max = Math.max(0, limit - size);
        return Math.min(Math.max(v - size / 2, 0), max);
    };
    return {
        x: tray.x + clamp(local.x, pen.w, tray.w),
        y: tray.y + clamp(local.y, pen.h, tray.h),
    };
}
