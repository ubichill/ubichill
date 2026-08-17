/**
 * ComponentConfig — Worker コード内でコンポーネントのメタデータを宣言するための型。
 *
 * 各 Worker ファイルで `export const config = { ... } satisfies ComponentConfig` を
 * 記述することで、ビルドツールがメタデータを自動抽出する。
 *
 * dataFields の値は Inspector での UI 定義として使用される。
 */

/**
 * Inspector で編集可能なフィールドの型。
 * `@ubichill/shared` の `ComponentDataFieldSpecSchema`（manifest 検証）・
 * `Ubi.state.sync` の `EditorFieldMeta` と型名を揃えている（string/enum 系）。
 */
export type DataFieldType = 'string' | 'number' | 'boolean' | 'color' | 'url' | 'enum' | 'json' | 'array';

/** 全データフィールド共通の基底 */
export interface BaseDataField {
    /** Inspector で表示されるラベル */
    label?: string;
    help?: string;
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

export interface StringDataField extends BaseDataField {
    type: 'string';
    default?: string;
    multiline?: boolean;
    placeholder?: string;
}

export interface BooleanDataField extends BaseDataField {
    type: 'boolean';
    default?: boolean;
}

export interface UrlDataField extends BaseDataField {
    type: 'url';
    default?: string;
    placeholder?: string;
}

export interface EnumDataField extends BaseDataField {
    type: 'enum';
    default?: string;
    options: readonly string[];
}

export interface JsonDataField extends BaseDataField {
    type: 'json';
    default?: unknown;
}

export interface ArrayDataField extends BaseDataField {
    type: 'array';
    default?: unknown[];
    /** 要素1つ分のフィールド定義（{ key: { type, label, default, ... } }） */
    item: Record<string, DataField>;
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
    | StringDataField
    | BooleanDataField
    | UrlDataField
    | EnumDataField
    | JsonDataField
    | ArrayDataField
    | EntityRefDataField
    | EntityRefArrayDataField;

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
}
