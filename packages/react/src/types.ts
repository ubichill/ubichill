/**
 * プラグインが Host (PluginRegistry) に渡す定義オブジェクト。
 *
 * React コンポーネントではなく Custom Elements タグ名で宣言する。
 * Host は elementTag / singletonTag で CE を生成し、コンテキストを注入する。
 */
export interface WidgetDefinition {
    /** プラグイン識別子（plugin.json の id と一致） */
    id: string;
    /** 表示名 */
    name: string;
    /** エンティティごとに描画される Custom Elements タグ名 */
    elementTag: string;
    /**
     * ワールド参加中に 1 つだけ描画される Custom Elements タグ名（オプション）。
     * 複数のシングルトンタグが必要な場合は singletonTags を使う。
     */
    singletonTag?: string;
    /** 複数のシングルトンタグを登録する場合（singletonTag との排他） */
    singletonTags?: string[];
    /**
     * このプラグインの Custom Elements を customElements.define する関数。
     * PluginRegistry がプラグインロード後に一度だけ呼び出す。
     */
    register: () => void;
}
