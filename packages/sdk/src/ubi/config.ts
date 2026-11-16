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

/** 参照フィールドに共通の宣言。 */
interface RefDataFieldBase extends BaseDataField {
    /**
     * 参照先への操作権限: 'read'（既定・省略可）は読み取りのみ、
     * 'write' は自身への読み書きと同様に参照先への transform/data 更新も許可する。
     * `component` を宣言していれば、読み書きできるのは参照先のその型の Component だけ。
     * 削除はこの参照からは決して許可されない（watchScope で見える Entity のみ削除可）。
     */
    access?: 'read' | 'write';
    /**
     * 参照先の Entity が持つべき Component 型（`"modId:componentName"`）。
     * World Editor はこの型を持つ Entity だけを受け付け、`Ubi.event.emit(type, data, { ref: <フィールド名> })` は
     * 参照先のこの型の Component に届く。Unity の型付きフィールドと同じ考え方で、作者は相手をどこに置いてもよい。
     */
    component?: string;
    /** 未設定をワールドの問題として扱う（World Editor と `ubichill dev` が知らせる）。配列は 1 つ以上。 */
    required?: boolean;
}

/** 他 Entity 単体への参照。値は entityId（World Editor で D&D 指定）。 */
export interface EntityRefDataField extends RefDataFieldBase {
    type: 'entityRef';
    /** World Editor で Component を足したときに data へ書く初期値。data に無いときの代わりの値にはならない。 */
    default?: string;
}

/** 他 Entity 複数への参照。値は entityId の配列。 */
export interface EntityRefArrayDataField extends RefDataFieldBase {
    type: 'entityRefArray';
    /** World Editor で Component を足したときに data へ書く初期値。data に無いときの代わりの値にはならない。 */
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
    /** エディタでこの Component の見た目として出す画像。assets/ 内の相対パス（png・jpg・webp・avif・svg、256 KB まで） */
    thumbnail?: string;
    /** シングルトン（1ワールドに1つまで） */
    singleton?: boolean;
    /** コンポーネントの説明 */
    description?: string;
    /**
     * data-only コンポーネント（Worker を持たない）。mod が spawn して持ち回るだけの Entity の型を宣言する
     * （例: pen の `stroke.worker.ts` が `pen:stroke` を宣言する）。宣言しない型を spawn しても Host は
     * コードを実行せずデータとして扱うが、打ち間違いと区別できないので開発者向けにコンソールへ知らせる。
     * このファイルのコードはバンドル・実行されない。
     */
    dataOnly?: boolean;
    /**
     * 画面固定オーバーレイ（HUD）として描画するか。角を指定すると transform.x/y をワールド座標では
     * なく「その角からの距離」として扱い、ワールドのスクロールに影響されなくなる（画面サイズ非依存）。
     * `'fill'` は画面全体を覆うレイヤーで、mod が自前の絶対配置で好きな場所に置ける
     * （左下にスティック・右下にボタン等）。`true` は `'top-left'` と同義。
     * 仮想パッド・常時表示スコア表示等に使う。World Editor で Entity ごとに上書きできる既定値。
     */
    overlay?: boolean | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'fill';
}
