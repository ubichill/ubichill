import { CURSOR_STATES, type CursorPosition, type CursorState, type UserStatus } from '@ubichill/shared';
import { z } from 'zod';

/**
 * Zodを使用したバリデーションスキーマ
 */

// ユーザー名のバリデーション: 1-50文字（日本語を含む全ての文字を許可）
export const usernameSchema = z
    .string()
    .min(1, 'ユーザー名は1文字以上である必要があります')
    .max(50, 'ユーザー名は50文字以下である必要があります')
    .trim();

// ワールドIDのバリデーション: 英数字、ハイフン、アンダースコアのみ
export const worldIdSchema = z
    .string()
    .min(1, 'ワールドIDは1文字以上である必要があります')
    .max(100, 'ワールドIDは100文字以下である必要があります')
    .regex(/^[a-zA-Z0-9_-]+$/, 'ワールドIDには英数字、ハイフン、アンダースコアのみ使用できます');

// カーソル位置のバリデーション: 妥当な画面範囲
export const cursorPositionSchema = z.object({
    x: z.number().min(-10000).max(100000),
    y: z.number().min(-10000).max(100000),
}) satisfies z.ZodType<CursorPosition>;

// ユーザーステータスのバリデーション
export const userStatusSchema = z.enum(['online', 'away', 'busy', 'offline']) satisfies z.ZodType<UserStatus>;

// カーソル状態のバリデーション（CURSOR_STATESから生成）
export const cursorStateSchema = z.enum(CURSOR_STATES) satisfies z.ZodType<CursorState>;

/**
 * バリデーションヘルパー関数
 */

export function validateUsername(username: string): { valid: true; data: string } | { valid: false; error: string } {
    const result = usernameSchema.safeParse(username);
    if (!result.success) {
        return { valid: false, error: result.error.issues[0].message };
    }
    return { valid: true, data: result.data };
}

export function validateWorldId(worldId: string): { valid: true; data: string } | { valid: false; error: string } {
    const result = worldIdSchema.safeParse(worldId);
    if (!result.success) {
        return { valid: false, error: result.error.issues[0].message };
    }
    return { valid: true, data: result.data };
}

export function validateCursorPosition(
    position: CursorPosition,
): { valid: true; data: CursorPosition } | { valid: false; error: string } {
    const result = cursorPositionSchema.safeParse(position);
    if (!result.success) {
        return { valid: false, error: result.error.issues[0].message };
    }
    return { valid: true, data: result.data };
}

export function validateUserStatus(
    status: string,
): { valid: true; data: UserStatus } | { valid: false; error: string } {
    const result = userStatusSchema.safeParse(status);
    if (!result.success) {
        return { valid: false, error: '無効なユーザーステータスです' };
    }
    return { valid: true, data: result.data };
}

export function validateCursorState(
    state: unknown,
): { valid: true; data: CursorState } | { valid: false; error: string } {
    const result = cursorStateSchema.safeParse(state);
    if (!result.success) {
        return { valid: false, error: '無効なカーソル状態です' };
    }
    return { valid: true, data: result.data };
}
