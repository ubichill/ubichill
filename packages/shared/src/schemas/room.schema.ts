import { z } from 'zod';

// ============================================
// 定数
// ============================================

export const LIMITS = {
    MAX_YAML_SIZE: 100 * 1024, // 100KB
    MAX_STRING_LENGTH: 1000,
    MAX_INITIAL_ENTITIES: 500,
    MAX_DEPENDENCY_DEPTH: 3,
    MAX_TAGS: 10,
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
// Room Environment（環境設定）
// ============================================

export const RoomEnvironmentSchema = z.object({
    backgroundColor: HexColor.default('#F0F8FF'),
    backgroundImage: z.string().url().nullable().optional(),
    bgm: z.string().url().nullable().optional(),
    worldSize: z
        .object({
            width: z.number().positive().default(2000),
            height: z.number().positive().default(1500),
        })
        .default({ width: 2000, height: 1500 }),
});

// ============================================
// Room Capacity（キャパシティ設定）
// ============================================

export const RoomCapacitySchema = z.object({
    default: z.number().int().positive().default(10),
    max: z.number().int().positive().default(20),
});

// ============================================
// Initial Entity（初期配置エンティティ）
// ============================================

export const InitialEntitySchema = z.object({
    kind: z.string(), // "package-name:kind-id"
    transform: TransformSchema,
    data: z.record(z.string(), z.unknown()).optional(),
});

// ============================================
// Room Permissions（権限設定）
// ============================================

export const RoomPermissionsSchema = z.object({
    allowGuestCreate: z.boolean().default(false),
    allowGuestDelete: z.boolean().default(false),
});

// ============================================
// Room Dependencies（依存関係）
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
// Room Definition（ルーム定義 CRD）
// ============================================

export const RoomDefinitionSchema = z.object({
    apiVersion: z.literal('ubichill.com/v1alpha1'),
    kind: z.literal('Room'),
    metadata: z.object({
        name: KebabCaseId,
        version: SemVer,
        author: AuthorSchema.optional(),
    }),
    spec: z.object({
        displayName: SafeString,
        description: SafeString.optional(),
        thumbnail: z.string().url().optional(),
        capacity: RoomCapacitySchema.default({ default: 10, max: 20 }),
        environment: RoomEnvironmentSchema.optional(),
        // 依存関係
        dependencies: z.array(DependencySchema).optional(),
        initialEntities: z.array(InitialEntitySchema).max(LIMITS.MAX_INITIAL_ENTITIES).default([]),
        permissions: RoomPermissionsSchema.optional(),
    }),
});

export type RoomDefinition = z.infer<typeof RoomDefinitionSchema>;
export type RoomEnvironment = z.infer<typeof RoomEnvironmentSchema>;
export type RoomCapacity = z.infer<typeof RoomCapacitySchema>;
export type InitialEntity = z.infer<typeof InitialEntitySchema>;

// ============================================
// Resolved Room（解決済みルーム）
// ============================================

export const ResolvedRoomSchema = z.object({
    id: z.string(),
    version: z.string(),
    displayName: z.string(),
    description: z.string().optional(),
    thumbnail: z.string().optional(),
    environment: RoomEnvironmentSchema,
    capacity: RoomCapacitySchema,
    // availableKinds は別途追加
    initialEntities: z.array(InitialEntitySchema),
});

export type ResolvedRoom = z.infer<typeof ResolvedRoomSchema>;
