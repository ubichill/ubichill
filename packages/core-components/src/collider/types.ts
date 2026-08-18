/** 2D 座標・オフセット。 */
export interface Vec2 {
    x: number;
    y: number;
}

/** ワールド上の矩形Collider。x/y は左上座標。 */
export interface RectGeometry {
    shape: 'rect';
    x: number;
    y: number;
    w: number;
    h: number;
}

/** ワールド上の円Collider。x/y は中心座標。 */
export interface CircleGeometry {
    shape: 'circle';
    x: number;
    y: number;
    radius: number;
}

export type ColliderGeometry = RectGeometry | CircleGeometry;

export interface ColliderBase {
    /** Entity transform の原点からのローカルオフセット。 */
    offset: Vec2;
    /** true は接触検知のみ。位置の押し戻しは今後のphysics層が担当する。 */
    isTrigger: boolean;
    /** 衝突グループ。 */
    layer: string;
    /** 接触対象にするレイヤー群。 */
    mask: string[];
}

export interface RectCollider extends ColliderBase {
    shape: 'rect';
    /** `entity` は同じEntityのtransform.w/hを使い、UI寸法とCollider寸法を共有する。 */
    size: { w: number; h: number } | 'entity';
}

export interface CircleCollider extends ColliderBase {
    shape: 'circle';
    /** offset の位置を中心とする半径。 */
    radius: number;
}

export type ColliderData = RectCollider | CircleCollider;

/** geometry を解決するのに必要なEntity transformの部分集合。 */
export interface ColliderTransform {
    x: number;
    y: number;
    w?: number;
    h?: number;
    scale?: number;
}
