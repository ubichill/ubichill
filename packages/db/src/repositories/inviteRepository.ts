import { and, eq, gt, inArray, lte } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db } from '../index';
import { instanceInvites, inviteRequests } from '../schema';

export interface InviteRecord {
    id: string;
    instanceId: string;
    inviterId: string;
    inviteeId: string;
    message: string | null;
    createdAt: Date;
    expiresAt: Date;
}

/** 招待とリクエストインバイト。送れるか・頼めるかの規則は shared の instanceAccess.ts（ここは保存だけ）。 */
export const inviteRepository = {
    /** 招待を保存する。同じ部屋・同じ相手の招待があれば、送った人・一言・期限を新しくする。 */
    async upsert(
        input: { instanceId: string; inviterId: string; inviteeId: string; message: string | null; expiresAt: Date },
        now = new Date(),
    ): Promise<InviteRecord> {
        const [row] = await db
            .insert(instanceInvites)
            .values({ id: nanoid(), ...input, createdAt: now })
            .onConflictDoUpdate({
                target: [instanceInvites.instanceId, instanceInvites.inviteeId],
                set: { inviterId: input.inviterId, message: input.message, createdAt: now, expiresAt: input.expiresAt },
            })
            .returning();
        if (!row) throw new Error('招待を保存できません');
        return row;
    },

    /** 期限内の招待（無ければ undefined）。 */
    async findValid(instanceId: string, inviteeId: string, now = new Date()): Promise<InviteRecord | undefined> {
        const [row] = await db
            .select()
            .from(instanceInvites)
            .where(
                and(
                    eq(instanceInvites.instanceId, instanceId),
                    eq(instanceInvites.inviteeId, inviteeId),
                    gt(instanceInvites.expiresAt, now),
                ),
            );
        return row;
    },

    /** この人が期限内の招待を持っている部屋（一覧で「入れる」を出すため）。 */
    async validInstanceIdsFor(
        inviteeId: string,
        instanceIds: readonly string[],
        now = new Date(),
    ): Promise<Set<string>> {
        if (instanceIds.length === 0) return new Set();
        const rows = await db
            .select({ instanceId: instanceInvites.instanceId })
            .from(instanceInvites)
            .where(
                and(
                    eq(instanceInvites.inviteeId, inviteeId),
                    inArray(instanceInvites.instanceId, [...instanceIds]),
                    gt(instanceInvites.expiresAt, now),
                ),
            );
        return new Set(rows.map((r) => r.instanceId));
    },

    /**
     * リクエストインバイトを保存する。2 人の間に期限内のリクエストがあれば作らない（'exists'）。
     * 期限の過ぎたものがあれば作り直す。
     */
    async createRequest(
        /** activityId: ほかのサーバーから届いた RequestInvite の id（連合） */
        input: { requesterId: string; targetId: string; expiresAt: Date; activityId?: string | null },
        now = new Date(),
    ): Promise<'created' | 'exists'> {
        const rows = await db
            .insert(inviteRequests)
            .values({ ...input, createdAt: now })
            .onConflictDoUpdate({
                target: [inviteRequests.requesterId, inviteRequests.targetId],
                set: { createdAt: now, expiresAt: input.expiresAt, activityId: input.activityId ?? null },
                setWhere: lte(inviteRequests.expiresAt, now),
            })
            .returning({ requesterId: inviteRequests.requesterId });
        return rows.length > 0 ? 'created' : 'exists';
    },

    /** 期限内のリクエストがあるか。 */
    async hasRequest(requesterId: string, targetId: string, now = new Date()): Promise<boolean> {
        const [row] = await db
            .select({ requesterId: inviteRequests.requesterId })
            .from(inviteRequests)
            .where(
                and(
                    eq(inviteRequests.requesterId, requesterId),
                    eq(inviteRequests.targetId, targetId),
                    gt(inviteRequests.expiresAt, now),
                ),
            );
        return !!row;
    },

    /** リクエストを片付ける（答えた・取り下げた）。あったら true。 */
    async removeRequest(requesterId: string, targetId: string): Promise<boolean> {
        const rows = await db
            .delete(inviteRequests)
            .where(and(eq(inviteRequests.requesterId, requesterId), eq(inviteRequests.targetId, targetId)))
            .returning({ requesterId: inviteRequests.requesterId });
        return rows.length > 0;
    },

    /** 期限の過ぎた招待とリクエストを消す。消した件数。 */
    async deleteExpired(now = new Date()): Promise<number> {
        const invites = await db
            .delete(instanceInvites)
            .where(lte(instanceInvites.expiresAt, now))
            .returning({ id: instanceInvites.id });
        const requests = await db
            .delete(inviteRequests)
            .where(lte(inviteRequests.expiresAt, now))
            .returning({ requesterId: inviteRequests.requesterId });
        return invites.length + requests.length;
    },
};
