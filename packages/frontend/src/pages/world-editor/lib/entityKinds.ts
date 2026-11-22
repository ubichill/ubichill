import {
    CORE_COMPONENT_TYPES,
    IMAGE_FITS,
    MEDIA_FITS,
    PORTAL_LABEL_MAX_LENGTH,
    SWITCH_LABEL_MAX_LENGTH,
    SWITCH_MAX_TARGETS,
    TEXT_ALIGNS,
    TEXT_SIZE_RANGE,
    UI_BORDER_WIDTH_MAX,
    UI_RADIUS_MAX,
    WARP_LABEL_MAX_LENGTH,
} from '@ubichill/core-components';
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
    // 画像の URL。このサーバーに画像を上げるボタンも出す（core:image）
    | { type: 'image'; default?: string; label?: string; help?: string }
    // optionLabels: 選択肢に出す名前（無ければ値をそのまま出す）
    | {
          type: 'enum';
          default?: string;
          options: string[];
          optionLabels?: Readonly<Record<string, string>>;
          label?: string;
          help?: string;
      }
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
    /**
     * Component を足したときの data。dataFields の default（data に無いときに描く値）より優先する。
     * 置いてすぐ見えるようにしたい値は、描く値を変えずにここで書く。
     */
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

/** スクリプト（ワープ・スイッチ・ポータル）の名前の欄の説明。動かし方は UI のボタンか、標準のボタン */
const SCRIPT_TRIGGER_HELP =
    '同じ Entity の UI を「ボタンにする」と、その UI を押したときに動きます。UI のボタンが無ければ、この名前の標準のボタンを出します。';

/** modのインストール有無に関係なく、Hostが必ず提供する組み込みComponent。 */
export const CORE_ENTITY_KINDS: AvailableEntityKind[] = [
    {
        modName: 'core',
        kind: CORE_COMPONENT_TYPES.collider,
        displayName: 'コライダー',
        suggestSize: true,
        defaultData: { ...createDefaultColliderData() },
        viewKind: 'logic',
    },
    {
        modName: 'core',
        kind: CORE_COMPONENT_TYPES.media,
        displayName: 'メディア',
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
        displayName: 'UI',
        suggestSize: true,
        defaultTransform: { w: 200, h: 80 },
        // 置いたときは白い角丸の四角にテキストが入る。data に無い項目は描かない（YAML で書いた UI と同じ）
        defaultData: { text: 'テキスト', size: 20, fill: '#ffffff', border: '#1b2a44', radius: 12 },
        dataFields: {
            text: { type: 'string', multiline: true, default: '', label: 'テキスト' },
            size: {
                type: 'number',
                default: 24,
                min: TEXT_SIZE_RANGE.min,
                max: TEXT_SIZE_RANGE.max,
                step: 1,
                label: '文字の大きさ（px）',
            },
            color: { type: 'color', default: '#1b2a44', label: '文字の色' },
            align: {
                type: 'enum',
                options: [...TEXT_ALIGNS],
                optionLabels: { left: '左', center: '中央', right: '右' },
                default: 'center',
                label: '揃え',
            },
            bold: { type: 'boolean', default: false, label: '太字' },
            fill: {
                type: 'string',
                default: 'transparent',
                label: '塗りの色',
                help: '#RRGGBB か transparent（塗りなし）。',
            },
            border: {
                type: 'string',
                default: 'transparent',
                label: '枠線の色',
                help: '#RRGGBB か transparent（枠線なし）。',
            },
            borderWidth: {
                type: 'number',
                default: 2,
                min: 0,
                max: UI_BORDER_WIDTH_MAX,
                step: 1,
                label: '枠線の太さ（px）',
            },
            radius: {
                type: 'number',
                default: 0,
                min: 0,
                max: UI_RADIUS_MAX,
                step: 1,
                label: '角丸（px）',
                help: '大きくすると丸くなります。',
            },
            button: {
                type: 'boolean',
                default: false,
                label: 'ボタンにする',
                help: '押せるようにして、押したときに同じ Entity のスクリプト（ワープ・スイッチ・ポータル）を動かします。',
            },
            markup: {
                type: 'string',
                multiline: true,
                label: 'HTML（上級者向け）',
                help: 'テキストの代わりに、看板・説明・リンクなどを HTML 風に書けます。使えるタグ・属性は mod の UI と同じ（script やイベント属性は動かない）。リンクは新しいタブで開く。ボタンにした UI では見た目だけで、リンクは押せない。',
            },
        },
        viewKind: 'jsx',
    },
    {
        modName: 'core',
        kind: CORE_COMPONENT_TYPES.image,
        displayName: 'イメージ',
        suggestSize: true,
        defaultTransform: { w: 320, h: 240 },
        dataFields: {
            src: {
                type: 'image',
                default: '',
                label: '画像',
                help: '画像を選んで上げるか、http(s) の URL を入れる。',
            },
            fit: {
                type: 'enum',
                options: [...IMAGE_FITS],
                default: 'contain',
                label: '収め方',
                help: 'contain は全体を見せる、cover は枠を埋める（端が切れる）、fill は枠に合わせて伸ばす。',
            },
            alt: { type: 'string', default: '', label: '説明', help: '読み上げや、読み込めないときに出す。' },
        },
        viewKind: 'jsx',
    },
    {
        modName: 'core',
        kind: CORE_COMPONENT_TYPES.text,
        displayName: 'テキスト',
        suggestSize: true,
        defaultTransform: { w: 320, h: 80 },
        defaultData: { text: 'ようこそ' },
        dataFields: {
            text: { type: 'string', multiline: true, default: '', label: '文字' },
            size: {
                type: 'number',
                default: 24,
                min: TEXT_SIZE_RANGE.min,
                max: TEXT_SIZE_RANGE.max,
                step: 1,
                label: '大きさ（px）',
            },
            color: { type: 'color', default: '#1b2a44', label: '文字の色' },
            background: {
                type: 'string',
                default: 'transparent',
                label: '背景の色',
                help: '#RRGGBB か transparent（背景なし）。',
            },
            align: { type: 'enum', options: [...TEXT_ALIGNS], default: 'left', label: '揃え' },
            bold: { type: 'boolean', default: false, label: '太字' },
        },
        viewKind: 'jsx',
    },
    {
        modName: 'core',
        kind: CORE_COMPONENT_TYPES.portal,
        displayName: 'ポータル',
        suggestSize: true,
        // 行き先のサムネイルの丸い窓（幅いっぱい）と、その上の名前
        defaultTransform: { w: 180, h: 228 },
        dataFields: {
            world: {
                type: 'string',
                default: '',
                placeholder: '@ID/名前',
                label: '行き先のワールド',
                help: 'ワールドのページの @ID/名前、このサーバーのワールドの ID、ワールドの URL のどれか。',
            },
            label: {
                type: 'string',
                default: '',
                placeholder: '行き先のワールドの名前',
                label: `名前（${PORTAL_LABEL_MAX_LENGTH} 文字まで）`,
                help: `空なら、行き先のワールドの名前を出します。${SCRIPT_TRIGGER_HELP}`,
            },
        },
        viewKind: 'jsx',
    },
    {
        modName: 'core',
        kind: CORE_COMPONENT_TYPES.warp,
        displayName: 'ワープ',
        suggestSize: true,
        defaultTransform: { w: 200, h: 56 },
        dataFields: {
            target: {
                type: 'entityRef',
                default: '',
                label: '行き先',
                help: '押すと、この Entity が画面の中心に来ます。ヒエラルキーから Entity をドラッグして選びます。',
            },
            label: {
                type: 'string',
                default: '',
                placeholder: 'ワープ',
                label: `名前（${WARP_LABEL_MAX_LENGTH} 文字まで）`,
                help: SCRIPT_TRIGGER_HELP,
            },
        },
        viewKind: 'jsx',
    },
    {
        modName: 'core',
        kind: CORE_COMPONENT_TYPES.switch,
        displayName: 'スイッチ',
        suggestSize: true,
        defaultTransform: { w: 200, h: 56 },
        dataFields: {
            targets: {
                type: 'entityRefArray',
                default: [],
                label: `見え隠れさせる Entity（${SWITCH_MAX_TARGETS} 個まで）`,
                help: '押すと、部屋の全員の画面で、選んだ Entity（とその子）の見える・見えないが切り替わります。最初に見せるかは、その Entity の「最初から見せる」で決めます。',
            },
            label: {
                type: 'string',
                default: '',
                placeholder: 'スイッチ',
                label: `名前（${SWITCH_LABEL_MAX_LENGTH} 文字まで）`,
                help: SCRIPT_TRIGGER_HELP,
            },
        },
        viewKind: 'jsx',
    },
    {
        modName: 'core',
        kind: CORE_COMPONENT_TYPES.spawn,
        displayName: 'スポーン',
        suggestSize: true,
        defaultTransform: { w: 160, h: 48 },
        dataFields: {},
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
