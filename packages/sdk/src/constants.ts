/**
 * UI レイヤーの z-index 定数
 */
export const Z_INDEX = {
    /** 背景レイヤー */
    BACKGROUND: 0,

    /** ワールドアイテム（通常のエンティティ） */
    WORLD_ITEMS: 100,

    /** ウィジェット（エンティティ）のベースレイヤー */
    WIDGET_BASE: 100,

    /** UIのベースレイヤー */
    UI_BASE: 1000,

    /** 持っているアイテム */
    HELD_ITEM: 1000,

    /** トレイなどの固定UI（ペンより下） */
    UI_TRAY: 50,

    /** モーダルやポップアップ */
    UI_MODAL: 2000,

    /** カーソルやオーバーレイテキスト */
    CURSOR: 9000,
} as const;
