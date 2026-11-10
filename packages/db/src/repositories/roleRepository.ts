import type { RoleFields } from '@ubichill/shared';
import { and, count, desc, eq, getTableColumns, gt, inArray, isNull, lte, or } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db } from '../index';
import { roleAssignments, roles, users } from '../schema';

export type RoleRecord = typeof roles.$inferSelect;
export type RoleWithCountRecord = RoleRecord & { memberCount: number };

export interface RoleAssignmentRecord {
    userId: string;
    role: RoleRecord;
    createdAt: Date;
    expiresAt: Date | null;
}

export interface RoleMemberRecord {
    user: { id: string; name: string; handle: string; image: string | null };
    createdAt: Date;
    expiresAt: Date | null;
}

const activeAt = (now: Date) => or(isNull(roleAssignments.expiresAt), gt(roleAssignments.expiresAt, now));

/** ロールとアサインの保存。入力の規則・管理者の判定・並びは shared の user/roles.ts（ここは保存だけ）。 */
export const roleRepository = {
    /** すべてのロールと、期限の切れていないメンバーの数。 */
    async list(now = new Date()): Promise<RoleWithCountRecord[]> {
        return db
            .select({
                ...getTableColumns(roles),
                memberCount: count(roleAssignments.userId),
            })
            .from(roles)
            .leftJoin(roleAssignments, and(eq(roleAssignments.roleId, roles.id), activeAt(now)))
            .groupBy(roles.id);
    },

    async findById(id: string, now = new Date()): Promise<RoleWithCountRecord | undefined> {
        const [row] = await db
            .select({ ...getTableColumns(roles), memberCount: count(roleAssignments.userId) })
            .from(roles)
            .leftJoin(roleAssignments, and(eq(roleAssignments.roleId, roles.id), activeAt(now)))
            .where(eq(roles.id, id))
            .groupBy(roles.id);
        return row;
    },

    async create(fields: RoleFields, now = new Date()): Promise<RoleRecord> {
        const [row] = await db
            .insert(roles)
            .values({ id: nanoid(), ...fields, createdAt: now, updatedAt: now })
            .returning();
        if (!row) throw new Error('ロールを保存できません');
        return row;
    },

    async update(id: string, fields: RoleFields, now = new Date()): Promise<RoleRecord | undefined> {
        const [row] = await db
            .update(roles)
            .set({ ...fields, updatedAt: now })
            .where(eq(roles.id, id))
            .returning();
        return row;
    },

    /** ロールを消す（アサインも一緒に消える）。 */
    async remove(id: string): Promise<boolean> {
        const rows = await db.delete(roles).where(eq(roles.id, id)).returning({ id: roles.id });
        return rows.length > 0;
    },

    /** 期限の切れていないメンバー（新しくアサインした順）。 */
    async members(roleId: string, now = new Date()): Promise<RoleMemberRecord[]> {
        return db
            .select({
                user: { id: users.id, name: users.name, handle: users.handle, image: users.image },
                createdAt: roleAssignments.createdAt,
                expiresAt: roleAssignments.expiresAt,
            })
            .from(roleAssignments)
            .innerJoin(users, eq(users.id, roleAssignments.userId))
            .where(and(eq(roleAssignments.roleId, roleId), activeAt(now)))
            .orderBy(desc(roleAssignments.createdAt), users.handle);
    },

    /** アサインする。すでにあれば期限だけ変える。 */
    async assign(
        input: { roleId: string; userId: string; expiresAt: Date | null },
        now = new Date(),
    ): Promise<{ createdAt: Date; expiresAt: Date | null }> {
        const [row] = await db
            .insert(roleAssignments)
            .values({ ...input, createdAt: now })
            .onConflictDoUpdate({
                target: [roleAssignments.roleId, roleAssignments.userId],
                set: { expiresAt: input.expiresAt },
            })
            .returning({ createdAt: roleAssignments.createdAt, expiresAt: roleAssignments.expiresAt });
        if (!row) throw new Error('アサインを保存できません');
        return row;
    },

    async unassign(roleId: string, userId: string): Promise<boolean> {
        const rows = await db
            .delete(roleAssignments)
            .where(and(eq(roleAssignments.roleId, roleId), eq(roleAssignments.userId, userId)))
            .returning({ userId: roleAssignments.userId });
        return rows.length > 0;
    },

    /** ユーザーたちのアサイン（期限の切れたものも返す。判定は shared の isActiveAssignment）。 */
    async assignmentsOf(userIds: readonly string[]): Promise<RoleAssignmentRecord[]> {
        if (userIds.length === 0) return [];
        return db
            .select({
                userId: roleAssignments.userId,
                role: getTableColumns(roles),
                createdAt: roleAssignments.createdAt,
                expiresAt: roleAssignments.expiresAt,
            })
            .from(roleAssignments)
            .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
            .where(inArray(roleAssignments.userId, [...userIds]));
    },

    /** 期限の切れたアサインを消す（定期の掃除）。 */
    async deleteExpired(now = new Date()): Promise<number> {
        const rows = await db
            .delete(roleAssignments)
            .where(lte(roleAssignments.expiresAt, now))
            .returning({ userId: roleAssignments.userId });
        return rows.length;
    },
};
