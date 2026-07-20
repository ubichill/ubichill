import { z } from 'zod';

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
 */
export const EntityComponentSchema = z.object({
    type: ComponentTypeSchema,
    data: z.record(z.string(), z.unknown()).default({}),
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

export const DependencySourceSchema = z.object({
    type: z.enum(['repository', 'npm', 'url']),
    path: z.string().optional(),
    url: z.string().url().optional(),
    version: z.string().optional(),
});

export const DependencySchema = z.object({
    name: z.string(),
    source: DependencySourceSchema,
});

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
});

export type ResolvedWorld = z.infer<typeof ResolvedWorldSchema>;
