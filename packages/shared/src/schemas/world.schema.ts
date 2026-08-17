import { z } from 'zod';
import { ModLockSchema } from './modLock.schema';

// ============================================
// 定数
// ============================================

export const LIMITS = {
    MAX_YAML_SIZE: 100 * 1024, // 100KB
    MAX_STRING_LENGTH: 1000,
    MAX_INITIAL_ENTITIES: 500,
    MAX_COMPONENTS_PER_ENTITY: 32,
    MAX_DEPENDENCY_DEPTH: 3,
    MAX_TAGS: 10,
    MAX_WORLDS_PER_USER: 5,
} as const;

// ============================================
// 共通スキーマ
// ============================================

/**
 * 安全な文字列（スクリプト注入防止）
 */
export const SafeString = z
    .string()
    .max(LIMITS.MAX_STRING_LENGTH)
    .refine((s) => !/<script/i.test(s), 'Script tags not allowed');

/**
 * kebab-case ID
 */
export const KebabCaseId = z
    .string()
    .min(1)
    .max(50)
    .regex(/^[a-z0-9-]+$/, 'Must be kebab-case');

/**
 * SemVer バージョン
 */
export const SemVer = z.string().regex(/^\d+\.\d+\.\d+$/, 'Must be valid SemVer (x.y.z)');

/**
 * 色コード（HEX）
 */
export const HexColor = z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Must be valid hex color');

/**
 * Transform（位置・サイズ・回転）
 */
export const TransformSchema = z.object({
    x: z.number(),
    y: z.number(),
    z: z.number().default(0),
    w: z.number().positive().optional(),
    h: z.number().positive().optional(),
    scale: z.number().positive().optional().default(1),
    rotation: z.number().default(0),
});

// ============================================
// Author 情報
// ============================================

export const AuthorSchema = z.object({
    name: SafeString,
    url: z.string().url().optional(),
});

// ============================================
// World Source（provenance / 由来）
// ワールドは URL で識別される。source はその URL が
// 「どこ由来か」を示すメタデータ（フェデレーション用）。
// ============================================

export const WorldSourceKind = {
    /** 本体（このインスタンス）がホストするワールド */
    Local: 'local',
    /** GitHub 上の YAML / ディレクトリ */
    GitHub: 'github',
    /** 設定されたレジストリ由来 */
    Registry: 'registry',
    /** 別の ubichill インスタンス由来 */
    RemoteInstance: 'remote-instance',
    /** 任意の外部 URL */
    Url: 'url',
} as const;

export const WorldSourceSchema = z.object({
    kind: z.enum([
        WorldSourceKind.Local,
        WorldSourceKind.GitHub,
        WorldSourceKind.Registry,
        WorldSourceKind.RemoteInstance,
        WorldSourceKind.Url,
    ]),
    /** ワールド YAML を取得できる正規 URL（＝ワールドの一意キー） */
    url: z.string().url(),
    /** 由来レジストリの表示名（例: "ubichill official"） */
    registryName: z.string().optional(),
    /** 由来 ubichill インスタンスの base URL（フェデレーション時） */
    originInstance: z.string().url().optional(),
});

export type WorldSource = z.infer<typeof WorldSourceSchema>;

/**
 * ワールドの canonical URL（機械: `.../api/v1/worlds/:id`）や共有 URL から、
 * ユーザーに配る**共有 URL**（`.../world/:id`）を作る。共有・コピーはこちらを使う。
 * ubichill ホストでない任意 URL（GitHub raw 等）はそのまま返す。
 */
export function worldShareUrl(url: string): string {
    const m = /^(https?:\/\/[^/]+)\/(?:api\/v1\/worlds|world)\/([^/?#]+)/.exec(url);
    return m ? `${m[1]}/world/${m[2]}` : url;
}

/**
 * ワールドの由来ドメインを返す。ローカル（このインスタンス）は null。
 * リモート/外部は host 部分（例 `example.com`）。
 * インスタンス詳細で「どのサーバー由来か」を名前の下に小さく出す用途。
 * 将来はサーバー設定のマーク＋名を出すが、今はドメインのみ。
 */
export function worldOriginDomain(source: WorldSource): string | null {
    if (source.kind === WorldSourceKind.Local) return null;
    // shared は DOM/Node 非依存なので URL は使わず素の文字列処理で host を取り出す。
    const base = source.originInstance ?? source.url;
    const host = base.replace(/^https?:\/\//i, '').replace(/[/?#].*$/, '');
    return host || null;
}

/** ワールドの由来（どのサーバー/レジストリか）を人間向けラベルにする。UI の origin バッジ用。 */
export function worldSourceLabel(source: WorldSource): string {
    switch (source.kind) {
        case WorldSourceKind.Local:
            return 'このインスタンス';
        case WorldSourceKind.GitHub:
            return source.registryName ? `GitHub: ${source.registryName}` : 'GitHub';
        case WorldSourceKind.RemoteInstance: {
            // shared は DOM/Node 非依存なので URL は使わず host 部分を素の文字列処理で取り出す。
            const host = source.originInstance?.replace(/^https?:\/\//i, '').replace(/[/?#].*$/, '');
            return host || '外部インスタンス';
        }
        case WorldSourceKind.Registry:
            return source.registryName ?? 'レジストリ';
        default:
            return '外部 URL';
    }
}

// ============================================
// World Environment（環境設定）
// ============================================

export const WorldEnvironmentSchema = z.object({
    backgroundColor: HexColor.default('#F0F8FF'),
    worldSize: z
        .object({
            width: z.number().positive().default(2000),
            height: z.number().positive().default(1500),
        })
        .default({ width: 2000, height: 1500 }),
});

// ============================================
// World Capacity（キャパシティ設定）
// ============================================

export const WorldCapacitySchema = z.object({
    default: z.number().int().positive().default(10),
    max: z.number().int().positive().default(20),
});

// ============================================
// Entity / Component（ECS スキーマ）
//
// 設計:
// - Entity (GameObject) は id + transform のみを持つ「箱」
// - Component (`<mod>:<name>`) が振る舞いを配布する
// - 1 Entity に複数の Component を載せられる
// ============================================

/**
 * Component 型識別子: `modId:componentName` 形式。
 * 例: `pen:tray`, `video-player:videoSurface`
 */
export const ComponentTypeSchema = z.string().regex(/^[a-z0-9-]+:[a-zA-Z0-9_-]+$/, 'Must be "modId:componentName"');

/**
 * Entity に載る 1 つの Component。
 *
 * `transform` は Entity 自体の transform に対する上書き。x/y は Entity 位置からの
 * 相対オフセット（子 Entity の x/y と同じ考え方）、w/h/z/rotation/scale は上書き値。
 * 省略時は Entity の transform をそのまま継承する（後方互換）。
 * 同一 Entity に複数 Component を載せたとき、互いの占有領域が衝突しないようにするための機構。
 */
export const EntityComponentSchema = z.object({
    type: ComponentTypeSchema,
    data: z.record(z.string(), z.unknown()).default({}),
    transform: TransformSchema.partial().optional(),
});

/**
 * Entity (GameObject) に付与する自由なタグ。
 * Unity の Tag 相当。フィルタ / クエリ / レイヤー用途で使う。
 * 安全のため kebab-case + 数字 + アンダースコア程度に限定。
 */
export const EntityTagSchema = z
    .string()
    .min(1)
    .max(40)
    .regex(/^[a-z0-9_-]+$/, 'tag は小文字英数 + - _ のみ');

/**
 * Initial Entity (GameObject)。
 * 1 Entity に複数 Component + 子 Entity を持つ Unity 風階層。
 * `transform` の x/y は親 Entity 基準の相対座標。
 */
export interface InitialEntity {
    id: string;
    transform: z.infer<typeof TransformSchema>;
    components: Array<z.infer<typeof EntityComponentSchema>>;
    tags: string[];
    children: InitialEntity[];
}

export const InitialEntitySchema: z.ZodType<InitialEntity> = z.lazy(() =>
    z.object({
        id: KebabCaseId,
        transform: TransformSchema,
        components: z.array(EntityComponentSchema).max(LIMITS.MAX_COMPONENTS_PER_ENTITY).default([]),
        tags: z.array(EntityTagSchema).max(LIMITS.MAX_TAGS).default([]),
        children: z.array(InitialEntitySchema).max(LIMITS.MAX_INITIAL_ENTITIES).default([]),
    }),
);

/**
 * `initialEntities` ツリー全体で id が一意であることを検証する純関数。
 * 重複があれば最初の衝突 id を返す。
 *
 * runtime flatten 時に `entityId` および `${entityId}::${i}` 形式の
 * ComponentInstance.id を生成するため、id 衝突は state/patch の誤適用に直結する。
 */
function findDuplicateId(entities: InitialEntity[]): string | null {
    const seen = new Set<string>();
    const walk = (e: InitialEntity): string | null => {
        if (seen.has(e.id)) return e.id;
        seen.add(e.id);
        for (const child of e.children) {
            const dup = walk(child);
            if (dup) return dup;
        }
        return null;
    };
    for (const e of entities) {
        const dup = walk(e);
        if (dup) return dup;
    }
    return null;
}

/** `initialEntities` 配列に対するツリー全体 id ユニーク制約。 */
export const InitialEntitiesSchema = z
    .array(InitialEntitySchema)
    .max(LIMITS.MAX_INITIAL_ENTITIES)
    .default([])
    .superRefine((entities, ctx) => {
        const dup = findDuplicateId(entities);
        if (dup) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: `Entity id "${dup}" がツリー内で重複しています (子孫を含めて一意である必要があります)`,
            });
        }
    });

/**
 * initialEntities ツリー（子孫含む）を走査し、使用 mod の modId を重複なく集める純関数。
 * component 型 `modId:componentName` の modId 部分を拾う。
 * loader（lock 構築）と backend（collectMods）が共有する単一の走査ロジック。
 */
export function collectModIds(entities: InitialEntity[]): string[] {
    const ids = new Set<string>();
    const walk = (e: InitialEntity): void => {
        for (const c of e.components) {
            const modId = c.type.split(':')[0];
            if (modId) ids.add(modId);
        }
        for (const child of e.children ?? []) walk(child);
    };
    for (const e of entities) walk(e);
    return [...ids];
}

// ============================================
// World Permissions（権限設定）
// ============================================

export const WorldPermissionsSchema = z.object({
    allowGuestCreate: z.boolean().default(false),
    allowGuestDelete: z.boolean().default(false),
});

// ============================================
// World Dependencies（依存関係）
// ============================================

// `type` はビルド時にどこから mod を取得するかを表す:
//  - 'local': このワールドをビルドする側のローカル mods ディレクトリから fs で解決する
//    （モノレポ内 mod 用。`path` はビルド時に一切参照されない装飾的フィールドだったため廃止）。
//  - 'url'  : 指定した URL から mod の lock.json 断片を個別に取得する（外部 mod 用。
//    `ubichill lock` がここから `ModLockEntry.baseUrl` を焼き込む）。
// 'repository'（旧名。'local' と同義）は既存ワールドの後方互換のためだけに読み取りを許可する
// （新規に書き出す側は必ず 'local' を使う）。'npm' は実装されたことがないため廃止。
export const DependencySourceSchema = z.object({
    type: z.enum(['local', 'url', 'repository']).transform((v) => (v === 'repository' ? 'local' : v)),
    url: z.string().url().optional(),
    // 完全一致 (x.y.z) の pin か、明示的な 'latest'（常に最新版を追う）のどちらか。
    // 省略時も 'latest' として扱う（既存ワールドとの後方互換）が、解決後は必ずどちらかの値になるため
    // 「省略＝最新追従」という暗黙の意味を読み手が推測する必要がない。
    version: z.union([SemVer, z.literal('latest')]).default('latest'),
});
export type DependencySource = z.infer<typeof DependencySourceSchema>;

export const DependencySchema = z.object({
    name: z.string(),
    source: DependencySourceSchema,
});
export type Dependency = z.infer<typeof DependencySchema>;

// ============================================
// World Definition（ワールド定義 CRD）
// ============================================

export const WorldDefinitionSchema = z.object({
    apiVersion: z.literal('ubichill.com/v1alpha1'),
    kind: z.literal('World'),
    metadata: z.object({
        name: KebabCaseId,
        version: SemVer,
        author: AuthorSchema.optional(),
    }),
    spec: z.object({
        displayName: SafeString,
        description: SafeString.optional(),
        thumbnail: z.string().url().optional(),
        capacity: WorldCapacitySchema.default({ default: 10, max: 20 }),
        environment: WorldEnvironmentSchema.optional(),
        // 依存関係
        dependencies: z.array(DependencySchema).optional(),
        initialEntities: InitialEntitiesSchema,
        permissions: WorldPermissionsSchema.optional(),
        // mod 完全性ロック（保存時に焼き込む）。外部 provenance のワールドでは
        // ロード時にこの hash と照合し、不一致 mod の実行を拒否する。
        lock: ModLockSchema.optional(),
    }),
});

export type WorldDefinition = z.infer<typeof WorldDefinitionSchema>;
export type WorldEnvironment = z.infer<typeof WorldEnvironmentSchema>;
export type WorldCapacity = z.infer<typeof WorldCapacitySchema>;
export type EntityComponentDef = z.infer<typeof EntityComponentSchema>;
export type ComponentType = z.infer<typeof ComponentTypeSchema>;
export type EntityTag = z.infer<typeof EntityTagSchema>;

// ============================================
// World Create Input（ブラウザフォーム用）
// metadata.name はサーバー側で nanoid 生成、author はセッションから補完するため不要。
// ============================================

export const WorldCreateInputSchema = z.object({
    displayName: SafeString,
    description: SafeString.optional(),
    thumbnail: z.string().url().optional(),
    capacity: WorldCapacitySchema.default({ default: 10, max: 20 }),
    environment: WorldEnvironmentSchema.optional(),
    dependencies: z.array(DependencySchema).optional(),
    initialEntities: InitialEntitiesSchema,
    permissions: WorldPermissionsSchema.optional(),
});

export type WorldCreateInput = z.infer<typeof WorldCreateInputSchema>;

// ============================================
// World Mod（ワールドが使う mod）
// ============================================

export const WorldModSchema = z.object({
    /** mod id（component 型 `modId:name` の modId、または dependency 名）。 */
    id: z.string(),
    /** バージョン（dependency に宣言があれば。component 由来のみだと不明）。 */
    version: z.string().optional(),
});

export type WorldMod = z.infer<typeof WorldModSchema>;

// ============================================
// Resolved World（解決済みワールド）
// ============================================

export const ResolvedWorldSchema = z.object({
    /** ワールドの一意キー＝正規 URL（instances/favorites はこれで参照する）。 */
    url: z.string().url(),
    /** 由来メタデータ（provenance）。 */
    source: WorldSourceSchema,
    id: z.string(), // 人間が読める識別子（name）
    authorId: z.string().optional(), // 本体作成ワールドのユーザーID（外部ワールドは無い場合あり）
    authorName: z.string().optional(), // YAML metadata.author.name
    version: z.string(),
    displayName: z.string(),
    description: z.string().optional(),
    thumbnail: z.string().optional(),
    environment: WorldEnvironmentSchema,
    capacity: WorldCapacitySchema,
    dependencies: z.array(DependencySchema).optional(),
    initialEntities: z.array(InitialEntitySchema),
    /** このワールドが使う mod 一覧（component 型と dependencies から算出。version は dependency 宣言由来）。 */
    mods: z.array(WorldModSchema).default([]),
    /** mod 完全性ロック（あれば）。ロード時の hash 照合・capability 天井に使う。 */
    lock: ModLockSchema.optional(),
});

export type ResolvedWorld = z.infer<typeof ResolvedWorldSchema>;
