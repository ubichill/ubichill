import { and, count, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { db } from '../../index';
import { remoteActors, remoteFriendships } from '../../schema';

export type RemoteFriendshipState = 'outgoing' | 'incoming' | 'accepted' | 'rejected';
export type RemoteFriendshipRecord = typeof remoteFriendships.$inferSelect;

export interface RemoteFriendshipWithActor extends RemoteFriendshipRecord {
    account: string;
    domain: string;
    name: string | null;
    icon: string | null;
    summary: string | null;
}

/** このサーバーのユーザーと、ほかのサーバーの actor のフレンドの関係。規則は backend の federation/friendships.ts。 */
export const remoteFriendshipRepository = {
    async get(userId: string, actorId: string): Promise<RemoteFriendshipRecord | undefined> {
        const [row] = await db
            .select()
            .from(remoteFriendships)
            .where(and(eq(remoteFriendships.userId, userId), eq(remoteFriendships.actorId, actorId)));
        return row;
    },

    /** 関係を置き換える（無ければ作る）。 */
    async put(
        input: {
            userId: string;
            actorId: string;
            state: RemoteFriendshipState;
            offerId: string;
            relationshipId: string;
            acceptId?: string | null;
        },
        now: Date,
    ): Promise<RemoteFriendshipRecord> {
        const values = { ...input, acceptId: input.acceptId ?? null, updatedAt: now };
        const [row] = await db
            .insert(remoteFriendships)
            .values({ ...values, createdAt: now })
            .onConflictDoUpdate({ target: [remoteFriendships.userId, remoteFriendships.actorId], set: values })
            .returning();
        if (!row) throw new Error('フレンドの関係を保存できません');
        return row;
    },

    /** 関係を消す。消した行を返す（無ければ undefined）。 */
    async remove(userId: string, actorId: string): Promise<RemoteFriendshipRecord | undefined> {
        const [row] = await db
            .delete(remoteFriendships)
            .where(and(eq(remoteFriendships.userId, userId), eq(remoteFriendships.actorId, actorId)))
            .returning();
        return row;
    },

    /** この actor との関係をすべて消す（actor が消えた・ブロックした）。 */
    async removeAllFor(actorId: string): Promise<RemoteFriendshipRecord[]> {
        return db.delete(remoteFriendships).where(eq(remoteFriendships.actorId, actorId)).returning();
    },

    async findByOffer(offerId: string): Promise<RemoteFriendshipRecord[]> {
        return db.select().from(remoteFriendships).where(eq(remoteFriendships.offerId, offerId));
    },

    async findByAccept(acceptId: string): Promise<RemoteFriendshipRecord[]> {
        return db.select().from(remoteFriendships).where(eq(remoteFriendships.acceptId, acceptId));
    },

    /** ユーザーの関係（actor の表示の情報付き。消えた actor は除く）。 */
    async listForUser(userId: string): Promise<RemoteFriendshipWithActor[]> {
        const rows = await db
            .select({
                friendship: remoteFriendships,
                account: remoteActors.account,
                domain: remoteActors.domain,
                name: remoteActors.name,
                icon: remoteActors.icon,
                summary: remoteActors.summary,
                deletedAt: remoteActors.deletedAt,
            })
            .from(remoteFriendships)
            .innerJoin(remoteActors, eq(remoteActors.id, remoteFriendships.actorId))
            .where(eq(remoteFriendships.userId, userId));
        return rows
            .filter((r) => r.deletedAt === null)
            .map((r) => ({
                ...r.friendship,
                account: r.account,
                domain: r.domain,
                name: r.name,
                icon: r.icon,
                summary: r.summary,
            }));
    },

    /** この actor とフレンドのユーザー（このサーバーの）。 */
    async acceptedUsersOf(actorId: string): Promise<string[]> {
        const rows = await db
            .select({ userId: remoteFriendships.userId })
            .from(remoteFriendships)
            .where(and(eq(remoteFriendships.actorId, actorId), eq(remoteFriendships.state, 'accepted')));
        return rows.map((r) => r.userId);
    },

    /** ユーザーとフレンドの actor（消えた actor は除く）。 */
    async acceptedActorsOf(userId: string): Promise<string[]> {
        const rows = await db
            .select({ actorId: remoteFriendships.actorId })
            .from(remoteFriendships)
            .innerJoin(remoteActors, eq(remoteActors.id, remoteFriendships.actorId))
            .where(
                and(
                    eq(remoteFriendships.userId, userId),
                    eq(remoteFriendships.state, 'accepted'),
                    isNull(remoteActors.deletedAt),
                ),
            );
        return rows.map((r) => r.actorId);
    },

    async countIncoming(userId: string): Promise<number> {
        const [row] = await db
            .select({ n: count() })
            .from(remoteFriendships)
            .where(and(eq(remoteFriendships.userId, userId), eq(remoteFriendships.state, 'incoming')));
        return row?.n ?? 0;
    },

    /**
     * ドメイン（ポート違い・サブドメインも）の actor との関係をすべて消す（連合しないと決めたとき）。消した関係を返す。
     */
    async removeForDomain(domain: string): Promise<RemoteFriendshipRecord[]> {
        const host = domain.toLowerCase().replace(/:\d+$/, '');
        const actors = db
            .select({ id: remoteActors.id })
            .from(remoteActors)
            .where(
                or(
                    eq(remoteActors.domain, domain.toLowerCase()),
                    sql`split_part(${remoteActors.domain}, ':', 1) = ${host}`,
                    sql`split_part(${remoteActors.domain}, ':', 1) LIKE ${`%.${host}`}`,
                ),
            );
        return db.delete(remoteFriendships).where(inArray(remoteFriendships.actorId, actors)).returning();
    },

    /** 失効した申請（受けたまま 30 日）と、冷却期間の過ぎた断った記録を消す。 */
    async deleteStale(incomingBefore: Date, rejectedBefore: Date): Promise<number> {
        const rows = await db
            .delete(remoteFriendships)
            .where(
                or(
                    and(eq(remoteFriendships.state, 'incoming'), lt(remoteFriendships.updatedAt, incomingBefore)),
                    and(eq(remoteFriendships.state, 'rejected'), lt(remoteFriendships.updatedAt, rejectedBefore)),
                ),
            )
            .returning({ userId: remoteFriendships.userId });
        return rows.length;
    },
};
