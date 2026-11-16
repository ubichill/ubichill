import { CORE_COMPONENT_TYPES, MEDIA_FITS } from '@ubichill/core-components';
import { createDefaultColliderData } from '@ubichill/runtime';
import type { OverlayMode } from '@ubichill/shared';
import { type PreviewImageSource, previewImageSource } from '../../../lib/mods/previewImage';

/**
 * modの data フィールド宣言。インスペクタで「必ず表示する」フィールドの仕様。
 */
export type DataFieldSpec =
    | { type: 'string'; default?: string; multiline?: boolean; placeholder?: string; label?: string; help?: string }
    | {
          type: 'number';
          default?: number;
          min?: number;
          max?: number;
          step?: number;
          label?: string;
          help?: string;
      }
    | { type: 'boolean'; default?: boolean; label?: string; help?: string }
    | { type: 'color'; default?: string; label?: string; help?: string }
    | { type: 'url'; default?: string; placeholder?: string; label?: string; help?: string }
    | { type: 'enum'; default?: string; options: string[]; label?: string; help?: string }
    | { type: 'json'; default?: unknown; label?: string; help?: string }
    // 配列: 各要素を item スキーマで編集する。エディタは「行リスト＋追加/削除」で描画する。
    | { type: 'array'; default?: unknown[]; item: DataFields; label?: string; help?: string }
    // 他 Entity（単体）への参照。値は entityId。Hierarchy からの D&D で指定する。
    // access: 'read'（既定）は読み取りのみ、'write' は参照先への更新も許可する。
    // component: 参照先が持つべき Component 型。required: 未設定をワールドの問題にする。
    | {
          type: 'entityRef';
          default?: string;
          access?: 'read' | 'write';
          component?: string;
          required?: boolean;
          label?: string;
          help?: string;
      }
    // 他 Entity（複数）への参照。値は entityId の配列。
    | {
          type: 'entityRefArray';
          default?: string[];
          access?: 'read' | 'write';
          component?: string;
          required?: boolean;
          label?: string;
          help?: string;
      };

export type DataFields = Record<string, DataFieldSpec>;

/**
 * modの manifest から取得できる、エディタで配置可能なエンティティ種別。
 */
export interface AvailableEntityKind {
    modName: string;
    kind: string; // "modName:entityKey"
    singleton?: boolean;
    canvasTargets?: string[];
    mediaTargets?: string[];
    /** デフォルトでサイズが必要そうかの推定（mediaTargets / canvasTargets を持つ場合は持たせる） */
    suggestSize: boolean;
    /** modが推奨する初期 transform（部分指定可） */
    defaultTransform?: Partial<{
        x: number;
        y: number;
        z: number;
        w: number;
        h: number;
        scale: number;
        rotation: number;
    }>;
    /** インスペクタで必ず表示する data フィールドの宣言 */
    dataFields?: DataFields;
    /** Component追加時にそのまま使うdata。dataFieldsの単純な既定値では表せない組み込みComponent向け。 */
    defaultData?: Record<string, unknown>;
    /** 見た目の画像（manifest の `thumbnail`。assetIntegrity で hash を固定したものだけ） */
    thumbnail?: PreviewImageSource;
    /** 表示名（manifest の `displayName`） */
    displayName?: string;
    /** 見た目の描画方式。manifest の canvasTargets / ui:render capability から自動判定。 */
    viewKind: 'jsx' | 'canvas' | 'logic';
    /** 画面固定オーバーレイの既定値（基準の角。`true` は `top-left`）。 */
    overlay?: OverlayMode;
}

/** modのインストール有無に関係なく、Hostが必ず提供する組み込みComponent。 */
export const CORE_ENTITY_KINDS: AvailableEntityKind[] = [
    {
        modName: 'core',
        kind: CORE_COMPONENT_TYPES.collider,
        suggestSize: true,
        defaultData: { ...createDefaultColliderData() },
        viewKind: 'logic',
    },
    {
        modName: 'core',
        kind: CORE_COMPONENT_TYPES.media,
        suggestSize: true,
        defaultTransform: { w: 640, h: 360 },
        dataFields: {
            fit: {
                type: 'enum',
                options: [...MEDIA_FITS],
                default: 'contain',
                label: '収め方',
                help: 'contain は全体を見せる（黒帯が出る）、cover は枠を埋める（端が切れる）。何を再生するかは、この Entity を参照した mod が決める。',
            },
        },
        viewKind: 'canvas',
    },
    {
        modName: 'core',
        kind: CORE_COMPONENT_TYPES.ui,
        suggestSize: true,
        defaultTransform: { w: 320, h: 160 },
        defaultData: { markup: '<div style="padding: 12px; background: #fff; border-radius: 8px">ようこそ</div>' },
        dataFields: {
            markup: {
                type: 'string',
                multiline: true,
                label: 'UI データ（HTML 風）',
                help: '看板・説明・リンクなど。使えるタグ・属性は mod の UI と同じ（script やイベント属性は動かない）。リンクは新しいタブで開く。',
            },
        },
        viewKind: 'jsx',
    },
];

/**
 * manifest の dataFields から、エディタが読める形の宣言だけを残す。manifest は読み込み時に検証しないので、
 * `null` などの崩れた宣言が 1 つあるだけで Inspector・参照の検査が落ちないようにする。
 */
export function usableDataFields(raw: unknown): DataFields | undefined {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
    return Object.fromEntries(
        Object.entries(raw).filter(
            (entry): entry is [string, DataFieldSpec] =>
                typeof entry[1] === 'object' &&
                entry[1] !== null &&
                typeof (entry[1] as { type?: unknown }).type === 'string',
        ),
    );
}

export interface VersionedManifestComponent {
    singleton?: boolean;
    canvasTargets?: string[];
    mediaTargets?: string[];
    capabilities?: string[];
    defaultTransform?: AvailableEntityKind['defaultTransform'];
    dataFields?: unknown;
    thumbnail?: string;
    displayName?: string;
    overlay?: OverlayMode;
    /** Worker を持たないデータ専用 Component（mod が spawn するだけで、エディタでは置かない） */
    dataOnly?: boolean;
}

/**
 * 見た目の描画方式を manifest の実体（canvasTargets / ui:render capability）から自動判定する。
 * 明示的な renderKind 宣言は持たず、「何を使っているか」で決める。
 *  - canvasTargets があれば Canvas2D（WebGL 含む）
 *  - ui:render capability（`export default` / Ubi.ui.render）があれば jsx（VNode）
 *  - どちらも無ければロジックのみ（見た目なし）
 */
function deriveViewKind(meta: VersionedManifestComponent): 'jsx' | 'canvas' | 'logic' {
    if (meta.canvasTargets?.length) return 'canvas';
    if (meta.capabilities?.includes('ui:render')) return 'jsx';
    return 'logic';
}

/**
 * 1 つの mod の manifest から、エディタで配置できる entity kind を作る（純粋）。
 * データ専用 Component（例: pen:stroke）は mod が実行中に spawn するものなので並べない。
 */
export function entityKindsFromManifest(
    modName: string,
    components: Record<string, VersionedManifestComponent>,
    versionedBase: string,
    assetIntegrity?: Readonly<Record<string, string>>,
): AvailableEntityKind[] {
    return Object.entries(components)
        .filter(([, meta]) => meta.dataOnly !== true)
        .map(([kind, meta]) => ({
            modName,
            kind,
            singleton: meta.singleton,
            canvasTargets: meta.canvasTargets,
            mediaTargets: meta.mediaTargets,
            suggestSize: !!(meta.canvasTargets?.length || meta.mediaTargets?.length),
            defaultTransform: meta.defaultTransform,
            dataFields: usableDataFields(meta.dataFields),
            thumbnail: previewImageSource({ assetIntegrity }, versionedBase, meta.thumbnail),
            displayName: meta.displayName,
            viewKind: deriveViewKind(meta),
            overlay: meta.overlay,
        }));
}

/**
 * WorldDefinition の dependencies に登録された各modの manifest を読み、
 * 配置可能な entity kind 一覧を返す。
 */
