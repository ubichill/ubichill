/**
 * アプリケーション Host フレームの Z-index 階層定義。
 *
 * プラグイン・エンティティの z-index は World YAML の transform.z で定義する。
 * ここでは React/DOM ツリーで直接指定が必要な Host フレームの固定 UI レイヤーのみ管理する。
 */
export const Z_INDEX = {
    /** InstanceRenderer ラッパー（Plugin レイヤー全体を包むコンテナ） */
    INSTANCE_FRAME: 1000,
    /** HUD 外枠（ツールバー等の常時表示コンテナ） */
    HUD: 10000,
    /** HUD 内パネル */
    HUD_PANEL: 10001,
    /** HUD 内オーバーレイ（モーダル等） */
    HUD_OVERLAY: 10002,
    /** バッジ・ツールチップ等の最前面要素 */
    TOP: 10003,
} as const;
