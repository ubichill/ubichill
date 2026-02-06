import { z } from 'zod';

// ============================================
// Access Type（アクセス種別）
// ============================================

export const AccessType = z.enum(['public', 'friend_plus', 'friend_only', 'invite_only']);
export type AccessType = z.infer<typeof AccessType>;

// ============================================
// Instance Status（インスタンス状態）
// ============================================

export const InstanceStatus = z.enum(['active', 'full', 'closing']);
export type InstanceStatus = z.infer<typeof InstanceStatus>;

// ============================================
// Instance Access（アクセス設定）
// ============================================

export const InstanceAccessSchema = z.object({
    type: AccessType.default('public'),
    tags: z.array(z.string().max(20)).max(10).default([]),
    password: z.boolean().default(false),
});

export type InstanceAccess = z.infer<typeof InstanceAccessSchema>;

// ============================================
// Instance Stats（統計情報）
// ============================================

export const InstanceStatsSchema = z.object({
    currentUsers: z.number().int().nonnegative(),
    maxUsers: z.number().int().positive(),
});

export type InstanceStats = z.infer<typeof InstanceStatsSchema>;

// ============================================
// Instance Connection（接続情報）
// ============================================

export const InstanceConnectionSchema = z.object({
    url: z.string(),
    namespace: z.string(),
});

export type InstanceConnection = z.infer<typeof InstanceConnectionSchema>;

// ============================================
// Instance（インスタンス）
// ============================================

export const InstanceSchema = z.object({
    id: z.string().uuid(),
    status: InstanceStatus,
    leaderId: z.string(),
    createdAt: z.string().datetime(),
    expiresAt: z.string().datetime().nullable(),

    room: z.object({
        id: z.string(),
        version: z.string(),
        displayName: z.string(),
        thumbnail: z.string().optional(),
    }),

    access: InstanceAccessSchema,
    stats: InstanceStatsSchema,
    connection: InstanceConnectionSchema,
});

export type Instance = z.infer<typeof InstanceSchema>;

// ============================================
// API Request/Response Types
// ============================================

/**
 * インスタンス作成リクエスト
 */
export const CreateInstanceRequestSchema = z.object({
    roomId: z.string(),
    access: z
        .object({
            type: AccessType.optional(),
            tags: z.array(z.string().max(20)).max(10).optional(),
            password: z.string().max(100).optional(),
        })
        .optional(),
    settings: z
        .object({
            maxUsers: z.number().int().positive().optional(),
        })
        .optional(),
});

export type CreateInstanceRequest = z.infer<typeof CreateInstanceRequestSchema>;

/**
 * インスタンス一覧取得クエリ
 */
export const ListInstancesQuerySchema = z.object({
    tag: z.string().optional(),
    includeFull: z.coerce.boolean().default(false),
});

export type ListInstancesQuery = z.infer<typeof ListInstancesQuerySchema>;

/**
 * ルーム一覧レスポンス（簡易版）
 */
export const RoomListItemSchema = z.object({
    id: z.string(),
    displayName: z.string(),
    description: z.string().optional(),
    thumbnail: z.string().optional(),
    version: z.string(),
    capacity: z.object({
        default: z.number(),
        max: z.number(),
    }),
});

export type RoomListItem = z.infer<typeof RoomListItemSchema>;
