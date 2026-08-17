/**
 * ComponentConfig — Worker コード内でコンポーネントのメタデータを宣言するための型。
 *
 * 各 Worker ファイルで `export const config = { ... } satisfies ComponentConfig` を
 * 記述することで、ビルドツールがメタデータを自動抽出する。
 *
 * dataFields の値は Inspector での UI 定義として使用される。
 */

/** Inspector で編集可能なフィールドの型 */
export type DataFieldType = 'color' | 'number' | 'text' | 'boolean' | 'select';

/** 全データフィールド共通の基底 */
export interface BaseDataField {
    /** Inspector で表示されるラベル */
    label?: string;
}

export interface ColorDataField extends BaseDataField {
    type: 'color';
    default: string;
}

export interface NumberDataField extends BaseDataField {
    type: 'number';
    default: number;
    min?: number;
    max?: number;
    step?: number;
}

export interface TextDataField extends BaseDataField {
    type: 'text';
    default: string;
}

export interface BooleanDataField extends BaseDataField {
    type: 'boolean';
    default: boolean;
}

export interface SelectDataField extends BaseDataField {
    type: 'select';
    default: string;
    options: readonly { value: string; label: string }[];
}

/** 他 Entity 単体への参照。値は entityId（World Editor で D&D 指定）。 */
export interface EntityRefDataField extends BaseDataField {
    type: 'entityRef';
    default?: string;
}

/** 他 Entity 複数への参照。値は entityId の配列。 */
export interface EntityRefArrayDataField extends BaseDataField {
    type: 'entityRefArray';
    default?: string[];
}

export type DataField =
    | ColorDataField
    | NumberDataField
    | TextDataField
    | BooleanDataField
    | SelectDataField
    | EntityRefDataField
    | EntityRefArrayDataField;

/**
 * この Component が View をどう描画するか。未指定 = ロジックのみ（見た目なし）。
 * - 'jsx'     : Ubi.jsx / Ubi.ui.render で VNode を返す（Host が Shadow DOM に変換）
 * - 'canvas'  : OffscreenCanvas に Canvas2D で直接描画
 * - 'threejs' : three.js 等 WebGL ライブラリで OffscreenCanvas に描画
 */
export type RenderKind = 'jsx' | 'canvas' | 'threejs';

/**
 * Worker ファイル内で export するコンポーネント構成宣言。
 * 各コンポーネント固有のメタデータをここに集約し、mod.json との二重管理を排除する。
 */
export interface ComponentConfig {
    /** Inspector で表示する UI 定義 */
    dataFields?: Record<string, DataField>;
    /** 同期の可視範囲 */
    watchScope?: 'entity' | 'subtree' | 'parent' | 'world';
    /** 監視するエンティティタイプ */
    watchEntityTypes?: readonly string[];
    /** デフォルトのトランスフォーム */
    defaultTransform?: Record<string, unknown>;
    /** コンポーネントが要求する権限の明示的なリスト */
    capabilities?: readonly string[];
    /** キャンバスターゲット */
    canvasTargets?: readonly string[];
    /** メディアターゲット */
    mediaTargets?: readonly string[];
    /** サムネイル画像のURL */
    thumbnail?: string;
    /** シングルトン（1ワールドに1つまで） */
    singleton?: boolean;
    /** コンポーネントの説明 */
    description?: string;
    /** data-only コンポーネント（Worker を持たない） */
    dataOnly?: boolean;
    /** View の描画方式。未指定ならロジックのみ（見た目なし）としてエディタに表示される。 */
    renderKind?: RenderKind;
}
