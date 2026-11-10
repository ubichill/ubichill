/**
 * ロール（Misskey のロールに合わせた、ユーザーに付ける属性）の純粋な知識。画面と API で同じ規則を使う。
 *
 * - 公開（isPublic）のロールはプロフィールに出る。非公開のロールはコントロールパネルでだけ見える
 * - 管理者（isAdministrator）のロールを持つ人は、このサーバーの管理者。公式アカウントはロールに関係なく常に管理者
 *   （Misskey のルートアカウントと同じく、外せない）
 * - アサインには期限を付けられる。過ぎたアサインは無いのと同じ
 * - 表示順（displayOrder）は大きいほど先に出す
 * - ほかのサーバーの人にはロールは無い
 */
import { z } from 'zod';
import { OFFICIAL_HANDLE } from './handle';

export const ROLE_LIMITS = {
    NAME_MAX: 20,
    DESCRIPTION_MAX: 200,
    DISPLAY_ORDER_MAX: 999,
} as const;

/** 新しいロールの色（画面の初期値）。 */
export const DEFAULT_ROLE_COLOR = '#6b7280';

const hasControlChar = (value: string): boolean =>
    Array.from(value).some((ch) => {
        const code = ch.codePointAt(0) ?? 0;
        return code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029;
    });

const codePoints = (value: string): number => Array.from(value).length;

export const RoleNameSchema = z
    .string()
    .transform((v) => v.trim())
    .refine((v) => v.length > 0, 'ロールの名前を入れてください')
    .refine((v) => !hasControlChar(v), 'ロールの名前は 1 行で書いてください')
    .refine((v) => codePoints(v) <= ROLE_LIMITS.NAME_MAX, `ロールの名前は ${ROLE_LIMITS.NAME_MAX} 文字以内です`);

/** 説明（任意）。改行は使える。空なら null。 */
export const RoleDescriptionSchema = z
    .string()
    .transform((v) => v.trim())
    .refine((v) => !hasControlChar(v.replace(/\r?\n/g, '')), '説明に制御文字は使えません（改行は使えます）')
    .refine((v) => codePoints(v) <= ROLE_LIMITS.DESCRIPTION_MAX, `説明は ${ROLE_LIMITS.DESCRIPTION_MAX} 文字以内です`)
    .transform((v) => (v === '' ? null : v));

/** 色は `#rrggbb`（小文字にそろえて保存する）。 */
export const RoleColorSchema = z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, '色は #rrggbb の形で指定してください')
    .transform((v) => v.toLowerCase());

/** ロールの作成・変更（`POST /api/v1/admin/roles`・`PUT /api/v1/admin/roles/:id`）の本文。送った値で置き換える。 */
export const RoleInputSchema = z
    .object({
        name: RoleNameSchema,
        description: RoleDescriptionSchema,
        color: RoleColorSchema,
        isPublic: z.boolean(),
        isAdministrator: z.boolean(),
        displayOrder: z.number().int().min(0).max(ROLE_LIMITS.DISPLAY_ORDER_MAX),
    })
    .strict();
export type RoleInput = z.input<typeof RoleInputSchema>;
export type RoleFields = z.output<typeof RoleInputSchema>;

/** アサイン（`PUT /api/v1/admin/roles/:id/members/:userId`）の本文。期限は ISO 8601（無期限は null）。 */
export const RoleAssignmentRequestSchema = z
    .object({ expiresAt: z.iso.datetime({ offset: true }).nullable() })
    .strict();
export type RoleAssignmentRequest = z.infer<typeof RoleAssignmentRequestSchema>;

/** 期限を確かめる。いまより前の期限では付けた瞬間に切れるので受け付けない。 */
export function assignmentExpiryOf(
    expiresAt: string | null,
    now: Date,
): { ok: true; expiresAt: Date | null } | { ok: false; error: string } {
    if (expiresAt === null) return { ok: true, expiresAt: null };
    const at = new Date(expiresAt);
    if (Number.isNaN(at.getTime())) return { ok: false, error: '期限の日時が正しくありません' };
    if (at.getTime() <= now.getTime()) return { ok: false, error: '期限はいまより後にしてください' };
    return { ok: true, expiresAt: at };
}

// ---- 表示の形 ----

/** プロフィールに出す公開のロール（`UserProfile.roles`）。 */
export interface PublicRole {
    id: string;
    name: string;
    color: string;
}

/** コントロールパネルで扱うロール（`GET /api/v1/admin/roles`）。 */
export interface Role extends PublicRole {
    description: string | null;
    isPublic: boolean;
    isAdministrator: boolean;
    displayOrder: number;
    /** 期限の切れていないアサインの数 */
    memberCount: number;
    createdAt: string;
    updatedAt: string;
}

/** ユーザーに付いているロール（コントロールパネルのユーザーの一覧）。 */
export interface AssignedRole extends PublicRole {
    isPublic: boolean;
    isAdministrator: boolean;
    /** 期限（無期限は null） */
    expiresAt: string | null;
}

/** ロールのメンバー（`GET /api/v1/admin/roles/:id/members`）。 */
export interface RoleMember {
    user: { id: string; name: string; handle: string; image: string | null };
    assignedAt: string;
    expiresAt: string | null;
}

/** コントロールパネルのユーザー（`GET /api/v1/admin/users`）。 */
export interface AdminUserView {
    id: string;
    name: string;
    handle: string;
    image: string | null;
    createdAt: string;
    /** 公式アカウント（常に管理者で、外せない） */
    isRoot: boolean;
    isAdmin: boolean;
    /** 期限の切れていないロール（表示順） */
    roles: AssignedRole[];
}

// ---- 判定 ----

/** 判定に要るロールの項目。 */
export interface RoleFacts extends PublicRole {
    isPublic: boolean;
    isAdministrator: boolean;
    displayOrder: number;
}

/** 判定に要るアサイン（DB の行を写したもの。期限の切れたものも混ざってよい）。 */
export interface RoleAssignmentFacts<R extends RoleFacts = RoleFacts> {
    role: R;
    expiresAt: Date | null;
}

export const isActiveAssignment = (assignment: { expiresAt: Date | null }, now: Date): boolean =>
    assignment.expiresAt === null || assignment.expiresAt.getTime() > now.getTime();

/** 公式アカウント（Misskey のルートアカウントにあたる。ロールに関係なく管理者）。 */
export const isRootHandle = (handle: string | null | undefined): boolean => handle === OFFICIAL_HANDLE;

/** このサーバーの管理者か。公式アカウントか、期限の切れていない管理者のロールを持っている人。 */
export function isAdministrator(
    handle: string | null | undefined,
    assignments: readonly RoleAssignmentFacts[],
    now: Date,
): boolean {
    return isRootHandle(handle) || assignments.some((a) => a.role.isAdministrator && isActiveAssignment(a, now));
}

/** ロールの並び: 表示順の大きい順 → 名前 → id（同じ値でも毎回同じ並びにする）。 */
export function compareRoles(a: Pick<RoleFacts, 'id' | 'name' | 'displayOrder'>, b: typeof a): number {
    if (a.displayOrder !== b.displayOrder) return b.displayOrder - a.displayOrder;
    if (a.name !== b.name) return a.name < b.name ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** 期限の切れていないロールを表示順に（1 人のアサインを渡す。同じロールは DB の主キーで重ならない）。 */
export function activeAssignmentsOf<R extends RoleFacts>(
    assignments: readonly RoleAssignmentFacts<R>[],
    now: Date,
): RoleAssignmentFacts<R>[] {
    return assignments.filter((a) => isActiveAssignment(a, now)).sort((a, b) => compareRoles(a.role, b.role));
}

/** プロフィールに出すロール: 公開で期限の切れていないものを表示順に。 */
export function publicRolesOf(assignments: readonly RoleAssignmentFacts[], now: Date): PublicRole[] {
    return activeAssignmentsOf(assignments, now)
        .filter((a) => a.role.isPublic)
        .map(({ role }) => ({ id: role.id, name: role.name, color: role.color }));
}

/** コントロールパネルに出すユーザーのロール（非公開も含む）。 */
export function assignedRolesOf(assignments: readonly RoleAssignmentFacts[], now: Date): AssignedRole[] {
    return activeAssignmentsOf(assignments, now).map(({ role, expiresAt }) => ({
        id: role.id,
        name: role.name,
        color: role.color,
        isPublic: role.isPublic,
        isAdministrator: role.isAdministrator,
        expiresAt: expiresAt?.toISOString() ?? null,
    }));
}
