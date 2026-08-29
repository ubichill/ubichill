/**
 * ペン先の位置計算（純関数。`Ubi` に触れないので単体テストできる）。
 *
 * ストロークは「カーソルの位置」ではなく「ペン先の実際の位置」から出す必要がある。
 * カーソル基準で描くと、持ち方(grip の offset)や見た目(サイズ・回転)を変えた瞬間に
 * 線とペン先がずれる。ここでペン先を箱座標として一元的に求め、持ち方は独立した値として
 * 扱うことで、持ち方を変えても線は必ずペン先から出る。
 *
 * 座標系: 「箱座標」= Gripable が描く `PEN_BOX` サイズの要素の左上を原点とする座標。
 */

/** ペン本体の箱サイズ。Gripable に渡す width/height と一致させる。 */
export const PEN_BOX = { w: 36, h: 48 } as const;
/** 箱の中央に配置する SVG のサイズ。 */
export const PEN_SVG = { w: 18, h: 32 } as const;
/** SVG 座標でのペン先（穂先 polygon の頂点）。 */
export const TIP_IN_SVG = { x: 9, y: 32 } as const;
/** 保持中の見た目の回転角（度）。 */
export const HELD_ROTATION_DEG = -30;
/** 回転の軸（箱座標）。CSS の `transform-origin: bottom right` に対応する。 */
export const HELD_ROTATION_ORIGIN = { x: PEN_BOX.w, y: PEN_BOX.h } as const;

export interface Point {
    x: number;
    y: number;
}

/** origin を軸に deg 度回転させる。 */
export function rotateAround(p: Point, origin: Point, deg: number): Point {
    const rad = (deg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const dx = p.x - origin.x;
    const dy = p.y - origin.y;
    return {
        x: origin.x + dx * cos - dy * sin,
        y: origin.y + dx * sin + dy * cos,
    };
}

/** 回転前のペン先（箱座標）。SVG は箱の中央に置かれる。 */
export const TIP_IN_BOX: Point = {
    x: (PEN_BOX.w - PEN_SVG.w) / 2 + TIP_IN_SVG.x,
    y: (PEN_BOX.h - PEN_SVG.h) / 2 + TIP_IN_SVG.y,
};

/** 保持中（回転後）のペン先（箱座標）。描くのは保持中だけなのでこちらを使う。 */
export const HELD_TIP_IN_BOX: Point = rotateAround(TIP_IN_BOX, HELD_ROTATION_ORIGIN, HELD_ROTATION_DEG);

/**
 * 既定の持ち方。ペン先が指（カーソル）の真下に来る位置でペンを掴む。
 *
 * これは「どう持つか」だけを決める値で、線の位置は {@link strokePointFor} が
 * ペン先から独立に計算する。ここを変えてもペン先から線が出る関係は壊れない。
 */
export const GRIP_OFFSET: Point = { x: -HELD_TIP_IN_BOX.x, y: -HELD_TIP_IN_BOX.y };

/**
 * カーソル位置から「その瞬間のペン先の位置」を求める。
 *
 * 保持中のペンは Host によって「カーソル + grip offset」の位置に描かれる（箱の左上がそこに来る）。
 * よってペン先は そこからさらに箱座標のペン先ぶん進んだ点になる。
 *
 * @param cursor 入力イベントのワールド座標
 * @param gripOffset 持ち方。既定は {@link GRIP_OFFSET}
 */
export function strokePointFor(cursor: Point, gripOffset: Point = GRIP_OFFSET): Point {
    return {
        x: cursor.x + gripOffset.x + HELD_TIP_IN_BOX.x,
        y: cursor.y + gripOffset.y + HELD_TIP_IN_BOX.y,
    };
}
