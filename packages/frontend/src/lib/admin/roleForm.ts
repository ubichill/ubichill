/**
 * コントロールパネルのロールの編集とアサインの、画面の状態の純粋な知識。入力の規則は shared の RoleInputSchema。
 */
import { type AssignedRole, DEFAULT_ROLE_COLOR, type Role, type RoleInput, RoleInputSchema } from '@ubichill/shared';

/** 編集中のロール（表示順は入力欄の文字のまま持つ）。 */
export interface RoleDraft {
    name: string;
    description: string;
    color: string;
    isPublic: boolean;
    isAdministrator: boolean;
    displayOrder: string;
}

/** 新しいロール。公開・管理者は明示して付ける（付け間違いで人に見せたり権限を渡したりしない）。 */
export const NEW_ROLE_DRAFT: RoleDraft = {
    name: '',
    description: '',
    color: DEFAULT_ROLE_COLOR,
    isPublic: false,
    isAdministrator: false,
    displayOrder: '0',
};

export const draftOf = (role: Role): RoleDraft => ({
    name: role.name,
    description: role.description ?? '',
    color: role.color,
    isPublic: role.isPublic,
    isAdministrator: role.isAdministrator,
    displayOrder: String(role.displayOrder),
});

const orderOf = (text: string): number => {
    const trimmed = text.trim();
    return /^\d+$/.test(trimmed) ? Number(trimmed) : Number.NaN;
};

/** 下書きを API の本文にする。通らなければ最初の理由（サーバーと同じ規則）。 */
export function roleInputOf(draft: RoleDraft): { ok: true; input: RoleInput } | { ok: false; error: string } {
    const input: RoleInput = {
        name: draft.name,
        description: draft.description,
        color: draft.color,
        isPublic: draft.isPublic,
        isAdministrator: draft.isAdministrator,
        displayOrder: orderOf(draft.displayOrder),
    };
    const parsed = RoleInputSchema.safeParse(input);
    if (parsed.success) return { ok: true, input };
    const issue = parsed.error.issues[0];
    return {
        ok: false,
        error: issue?.path[0] === 'displayOrder' ? '表示順は 0〜999 の整数です' : (issue?.message ?? '入力が不正です'),
    };
}

export const EXPIRY_PRESETS = [
    { id: 'none', label: '無期限', ms: null },
    { id: '1h', label: '1 時間', ms: 60 * 60 * 1000 },
    { id: '1d', label: '1 日', ms: 24 * 60 * 60 * 1000 },
    { id: '7d', label: '1 週間', ms: 7 * 24 * 60 * 60 * 1000 },
    { id: '30d', label: '30 日', ms: 30 * 24 * 60 * 60 * 1000 },
] as const;
export type ExpiryPreset = (typeof EXPIRY_PRESETS)[number]['id'];

export const isExpiryPreset = (value: string): value is ExpiryPreset => EXPIRY_PRESETS.some((p) => p.id === value);

/** アサインの期限（ISO 8601。無期限は null）。 */
export function expiresAtOf(preset: ExpiryPreset, now: Date): string | null {
    const ms = EXPIRY_PRESETS.find((p) => p.id === preset)?.ms ?? null;
    return ms === null ? null : new Date(now.getTime() + ms).toISOString();
}

const expiryFormat = new Intl.DateTimeFormat('ja-JP', { dateStyle: 'medium', timeStyle: 'short' });

export const expiryLabel = (expiresAt: string | null): string =>
    expiresAt === null ? '無期限' : `${expiryFormat.format(new Date(expiresAt))} まで`;

/** まだ付いていないロール（並びは渡した順のまま）。 */
export const assignableRoles = (roles: readonly Role[], assigned: readonly Pick<AssignedRole, 'id'>[]): Role[] =>
    roles.filter((r) => !assigned.some((a) => a.id === r.id));
