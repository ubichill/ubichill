/**
 * アプリケーション全体のZ-index階層定義
 * マジックナンバーを避け、相対的な重なり順をここで管理する
 */
export const Z_INDEX = {
    // Canvas/World (0-99)
    WORLD_BASE: 0,
    WORLD_ITEMS: 11,

    // UI Layer (100-999)
    UI_BASE: 100,
    UI_TRAY: 10, // トレイなど
    UI_HEADER: 600, // ヘッダー（もしあれば）

    // Interaction Layer (1000-9999)
    HELD_ITEM: 1000, // 持っているアイテム（最優先）
    CURSOR: 9999, // カーソル
} as const;
