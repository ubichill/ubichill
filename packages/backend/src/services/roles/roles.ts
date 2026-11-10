import {
    type AdminUserView,
    assignedRolesOf,
    assignmentExpiryOf,
    compareRoles,
    isAdministrator,
    isRootHandle,
    type PublicRole,
    parseUserSearchQuery,
    publicRolesOf,
    type Role,
    RoleAssignmentRequestSchema,
    type RoleFacts,
    type RoleFields,
    RoleInputSchema,
    type RoleMember,
} from '@ubichill/shared';
import type { ZodError } from 'zod';

export interface StoredRole extends RoleFacts {
    description: string | null;
    createdAt: Date;
    updatedAt: Date;
}

export interface StoredAssignment {
    userId: string;
    role: StoredRole;
    expiresAt: Date | null;
}

export interface StoredMember {
    user: { id: string; name: string; handle: string; image: string | null };
    createdAt: Date;
    expiresAt: Date | null;
}

export interface RoleUser {
    id: string;
    name: string;
    handle: string;
    image: string | null;
    createdAt: Date;
}

/** ロールとアサインの保存（@ubichill/db の roleRepository）。 */
export interface RoleStore {
    list(now: Date): Promise<Array<StoredRole & { memberCount: number }>>;
    findById(id: string, now: Date): Promise<(StoredRole & { memberCount: number }) | undefined>;
    create(fields: RoleFields, now: Date): Promise<StoredRole>;
    update(id: string, fields: RoleFields, now: Date): Promise<StoredRole | undefined>;
    remove(id: string): Promise<boolean>;
    members(roleId: string, now: Date): Promise<StoredMember[]>;
    assign(
        input: { roleId: string; userId: string; expiresAt: Date | null },
        now: Date,
    ): Promise<{ createdAt: Date; expiresAt: Date | null }>;
    unassign(roleId: string, userId: string): Promise<boolean>;
    /** 期限の切れたものも含めて返す */
    assignmentsOf(userIds: readonly string[]): Promise<StoredAssignment[]>;
}

/** ユーザーを引く（@ubichill/db の userRepository）。 */
export interface RoleUserStore {
    findById(id: string): Promise<RoleUser | undefined>;
    findByHandle(handle: string): Promise<RoleUser | undefined>;
    search(
        query: { handlePrefix: string | null; nameKey: string },
        options: { limit: number; excludeIds: readonly string[] },
    ): Promise<RoleUser[]>;
    listRecent(options: { limit: number; excludeIds: readonly string[] }): Promise<RoleUser[]>;
}

export interface RoleServiceDeps {
    roles: RoleStore;
    users: RoleUserStore;
    /** このサーバーのドメイン（`@handle@domain` の検索で使う） */
    localDomain: () => string;
    /** ロールを付けられず、検索にも出さないユーザー（システムユーザー） */
    hiddenUserIds: readonly string[];
    now?: () => Date;
}

export type RoleOutcome<T> = { ok: true; value: T } | { ok: false; status: 400 | 404; error: string };

export const USER_LIST_LIMIT = 30;

const ok = <T>(value: T): RoleOutcome<T> => ({ ok: true, value });
const notFound = (error: string): RoleOutcome<never> => ({ ok: false, status: 404, error });
const invalid = (error: ZodError | string): RoleOutcome<never> => {
    if (typeof error === 'string') return { ok: false, status: 400, error };
    const issue = error.issues[0];
    return {
        ok: false,
        status: 400,
        error: issue ? `${issue.path.join('.')}: ${issue.message}`.replace(/^: /, '') : '入力が不正です',
    };
};

const roleView = (role: StoredRole, memberCount: number): Role => ({
    id: role.id,
    name: role.name,
    description: role.description,
    color: role.color,
    isPublic: role.isPublic,
    isAdministrator: role.isAdministrator,
    displayOrder: role.displayOrder,
    memberCount,
    createdAt: role.createdAt.toISOString(),
    updatedAt: role.updatedAt.toISOString(),
});

const memberView = (member: StoredMember): RoleMember => ({
    user: member.user,
    assignedAt: member.createdAt.toISOString(),
    expiresAt: member.expiresAt?.toISOString() ?? null,
});

/**
 * ロール（コントロールパネル）と管理者の判定。HTTP の形には依存しない（routes/admin.ts が対応付ける）。
 * 入力の規則・判定・並びは shared の user/roles.ts。
 */
export function createRoleService(deps: RoleServiceDeps) {
    const now = deps.now ?? (() => new Date());
    const hidden = new Set(deps.hiddenUserIds);
    const findUser = async (userId: string): Promise<RoleUser | undefined> =>
        hidden.has(userId) ? undefined : deps.users.findById(userId);

    const usersView = async (users: readonly RoleUser[]): Promise<AdminUserView[]> => {
        const assignments = await deps.roles.assignmentsOf(users.map((u) => u.id));
        const at = now();
        return users.map((user) => {
            const own = assignments.filter((a) => a.userId === user.id);
            return {
                id: user.id,
                name: user.name,
                handle: user.handle,
                image: user.image,
                createdAt: user.createdAt.toISOString(),
                isRoot: isRootHandle(user.handle),
                isAdmin: isAdministrator(user.handle, own, at),
                roles: assignedRolesOf(own, at),
            };
        });
    };

    return {
        /** このサーバーの管理者か（公式アカウントは常に。ほかは期限の切れていない管理者のロールを持つ人）。 */
        async isAdmin(userId: string): Promise<boolean> {
            const user = await findUser(userId);
            if (!user) return false;
            if (isRootHandle(user.handle)) return true;
            return isAdministrator(user.handle, await deps.roles.assignmentsOf([user.id]), now());
        },

        /** プロフィールに出すロール。 */
        async publicRolesOf(userId: string): Promise<PublicRole[]> {
            return publicRolesOf(await deps.roles.assignmentsOf([userId]), now());
        },

        async listRoles(): Promise<Role[]> {
            const roles = await deps.roles.list(now());
            return [...roles].sort(compareRoles).map((r) => roleView(r, r.memberCount));
        },

        async createRole(body: unknown): Promise<RoleOutcome<Role>> {
            const parsed = RoleInputSchema.safeParse(body);
            if (!parsed.success) return invalid(parsed.error);
            return ok(roleView(await deps.roles.create(parsed.data, now()), 0));
        },

        async updateRole(roleId: string, body: unknown): Promise<RoleOutcome<Role>> {
            const parsed = RoleInputSchema.safeParse(body);
            if (!parsed.success) return invalid(parsed.error);
            const at = now();
            const updated = await deps.roles.update(roleId, parsed.data, at);
            if (!updated) return notFound('ロールがありません');
            const counted = await deps.roles.findById(roleId, at);
            return ok(roleView(updated, counted?.memberCount ?? 0));
        },

        async deleteRole(roleId: string): Promise<RoleOutcome<null>> {
            return (await deps.roles.remove(roleId)) ? ok(null) : notFound('ロールがありません');
        },

        async members(roleId: string): Promise<RoleOutcome<RoleMember[]>> {
            const at = now();
            if (!(await deps.roles.findById(roleId, at))) return notFound('ロールがありません');
            return ok((await deps.roles.members(roleId, at)).map(memberView));
        },

        /** アサインする（すでにあれば期限を変える）。 */
        async assign(roleId: string, userId: string, body: unknown): Promise<RoleOutcome<RoleMember>> {
            const parsed = RoleAssignmentRequestSchema.safeParse(body);
            if (!parsed.success) return invalid('期限（expiresAt）は日時か null で指定してください');
            const at = now();
            const expiry = assignmentExpiryOf(parsed.data.expiresAt, at);
            if (!expiry.ok) return invalid(expiry.error);
            const [role, user] = await Promise.all([deps.roles.findById(roleId, at), findUser(userId)]);
            if (!role) return notFound('ロールがありません');
            if (!user) return notFound('ユーザーがいません');
            const saved = await deps.roles.assign({ roleId, userId, expiresAt: expiry.expiresAt }, at);
            return ok(
                memberView({
                    user: { id: user.id, name: user.name, handle: user.handle, image: user.image },
                    ...saved,
                }),
            );
        },

        async unassign(roleId: string, userId: string): Promise<RoleOutcome<null>> {
            return (await deps.roles.unassign(roleId, userId)) ? ok(null) : notFound('アサインがありません');
        },

        /**
         * ユーザーとロール。検索語が無ければ新しく登録した順。ほかのサーバーの人にはロールを付けられないので出さない。
         */
        async searchUsers(q: string): Promise<RoleOutcome<AdminUserView[]>> {
            const query = parseUserSearchQuery(q, deps.localDomain());
            const options = { limit: USER_LIST_LIMIT, excludeIds: deps.hiddenUserIds };
            switch (query.kind) {
                case 'tooLong':
                    return invalid('検索語が長すぎます');
                case 'remote':
                    return ok([]);
                case 'empty':
                    return ok(await usersView(await deps.users.listRecent(options)));
                case 'local': {
                    const user = await deps.users.findByHandle(query.handle);
                    return ok(await usersView(user && !hidden.has(user.id) ? [user] : []));
                }
                case 'text':
                    return ok(await usersView(await deps.users.search(query, options)));
            }
        },
    };
}

export type RoleService = ReturnType<typeof createRoleService>;
