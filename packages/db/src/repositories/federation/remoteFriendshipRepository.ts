import { and, count, eq, inArray, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';
import { db } from '../../index';
import { remoteActors, remoteFriendships } from '../../schema';
import type { Tx } from '../credentialUser';
import { deliveryRepository, type NewDelivery } from './deliveryRepository';

export type RemoteFriendshipState = 'outgoing' | 'incoming' | 'accepted' | 'rejected';
export type RemoteFriendshipRecord = typeof remoteFriendships.$inferSelect;

export interface RemoteFriendshipInput {
    state: RemoteFriendshipState;
    offerId: string;
    relationshipId: string;
    acceptId?: string | null;
    peerOfferId?: string | null;
}

/** ロック中の 2 人の関係の読み書き（`locked` の中だけで使う。すべて同じトランザクション）。 */
export interface RemoteFriendshipWriter {
    put(input: RemoteFriendshipInput, now: Date): Promise<RemoteFriendshipRecord>;
    remove(): Promise<void>;
    /** このユーザーが受けたままの申請の数 */
    countIncoming(): Promise<number>;
    /** activity を送る予定に入れる（関係の書き込みと一緒に確定する） */
    enqueue(delivery: NewDelivery, now: Date): Promise<void>;
}

async function putRow(
    q: typeof db | Tx,
    input: RemoteFriendshipInput & { userId: string; actorId: string },
    now: Date,
): Promise<RemoteFriendshipRecord> {
    const values = {
        ...input,
        acceptId: input.acceptId ?? null,
        peerOfferId: input.peerOfferId ?? null,
        updatedAt: now,
    };
    const [row] = await q
        .insert(remoteFriendships)
        .values({ ...values, createdAt: now })
        .onConflictDoUpdate({ target: [remoteFriendships.userId, remoteFriendships.actorId], set: values })
        .returning();
    if (!row) throw new Error('フレンドの関係を保存できません');
    return row;
}

async function countIncomingOf(q: typeof db | Tx, userId: string): Promise<number> {
    const [row] = await q
        .select({ n: count() })
        .from(remoteFriendships)
        .where(and(eq(remoteFriendships.userId, userId), eq(remoteFriendships.state, 'incoming')));
    return row?.n ?? 0;
}

const pairOf = (userId: string, actorId: string) =>
    and(eq(remoteFriendships.userId, userId), eq(remoteFriendships.actorId, actorId));

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
        const [row] = await db.select().from(remoteFriendships).where(pairOf(userId, actorId));
        return row;
    },

    /** 関係を置き換える（無ければ作る）。 */
    async put(
        input: RemoteFriendshipInput & { userId: string; actorId: string },
        now: Date,
    ): Promise<RemoteFriendshipRecord> {
        return putRow(db, input, now);
    },

    /**
     * 2 人の関係をロックし、今の行を読んで `fn` を実行する（1 トランザクション。`fn` が投げたら書き込みは戻る）。
     * 申請と相手からの申請の受け取りが同時に走ると、どちらも「関係なし」と読んで片方の書き込みが消えるため。
     * 行がまだ無くても押さえられるよう、行ではなく 2 人の組でロックする。
     * `fn` の中では `write` だけで DB に触る（別の接続を待つと、接続を使い切ったときに全員が止まる）。
     */
    async locked<T>(
        userId: string,
        actorId: string,
        fn: (current: RemoteFriendshipRecord | undefined, write: RemoteFriendshipWriter) => Promise<T>,
    ): Promise<T> {
        return db.transaction(async (tx) => {
            await tx.execute(
                sql`select pg_advisory_xact_lock(hashtextextended(${`remote_friendships:${userId}\n${actorId}`}, 0))`,
            );
            const [current] = await tx.select().from(remoteFriendships).where(pairOf(userId, actorId));
            return fn(current, {
                put: (input, now) => putRow(tx, { ...input, userId, actorId }, now),
                remove: async () => {
                    await tx.delete(remoteFriendships).where(pairOf(userId, actorId));
                },
                countIncoming: () => countIncomingOf(tx, userId),
                enqueue: (delivery, now) => deliveryRepository.enqueue(delivery, now, tx),
            });
        });
    },

    /** 関係を消す。消した行を返す（無ければ undefined）。 */
    async remove(userId: string, actorId: string): Promise<RemoteFriendshipRecord | undefined> {
        const [row] = await db.delete(remoteFriendships).where(pairOf(userId, actorId)).returning();
        return row;
    },

    /** この actor との関係をすべて消す（actor が消えた・ブロックした）。 */
    async removeAllFor(actorId: string): Promise<RemoteFriendshipRecord[]> {
        return db.delete(remoteFriendships).where(eq(remoteFriendships.actorId, actorId)).returning();
    },

    /** その Offer の関係（申請の Offer か、お互いに申請したときの相手の Offer）。 */
    async findByOffer(offerId: string): Promise<RemoteFriendshipRecord[]> {
        return db
            .select()
            .from(remoteFriendships)
            .where(or(eq(remoteFriendships.offerId, offerId), eq(remoteFriendships.peerOfferId, offerId)));
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
        return countIncomingOf(db, userId);
    },

    /** 消えた actor との関係を消す（消えた知らせの処理と行き違って書かれたもの）。消した関係を返す。 */
    async removeForDeletedActors(): Promise<RemoteFriendshipRecord[]> {
        const gone = db.select({ id: remoteActors.id }).from(remoteActors).where(isNotNull(remoteActors.deletedAt));
        return db.delete(remoteFriendships).where(inArray(remoteFriendships.actorId, gone)).returning();
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
