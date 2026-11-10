import { and, count, desc, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { db } from '../../index';
import { federationFollowers, type RemoteActorProfileRecord, remoteActors } from '../../schema';
import type { Tx } from '../credentialUser';
import { deliveryRepository, type NewDelivery } from './deliveryRepository';
import type { RemoteActorRecord } from './remoteActorRepository';

export type FollowerState = 'pending' | 'accepted';
export type FollowerRecord = typeof federationFollowers.$inferSelect;

/** ロック中の 2 人のフォローの読み書き（`locked` の中だけで使う。すべて同じトランザクション）。 */
export interface FollowerWriter {
    put(input: { state: FollowerState; followId: string }, now: Date): Promise<FollowerRecord>;
    remove(): Promise<void>;
    /** このユーザーの承認待ちの数 */
    countPending(): Promise<number>;
    /** activity を送る予定に入れる（フォローの書き込みと一緒に確定する） */
    enqueue(delivery: NewDelivery, now: Date): Promise<void>;
}

export interface FollowerWithActor extends FollowerRecord {
    account: string;
    name: string | null;
    icon: string | null;
    url: string | null;
    /** 名前のカスタム絵文字を出すのに使う（形は shared で確かめる） */
    profile: RemoteActorProfileRecord;
}

const pairOf = (userId: string, actorId: string) =>
    and(eq(federationFollowers.userId, userId), eq(federationFollowers.actorId, actorId));

async function countPendingOf(q: typeof db | Tx, userId: string): Promise<number> {
    const [row] = await q
        .select({ n: count() })
        .from(federationFollowers)
        .where(and(eq(federationFollowers.userId, userId), eq(federationFollowers.state, 'pending')));
    return row?.n ?? 0;
}

/** このサーバーのユーザーをフォローしている、ほかのサーバーの actor。規則は backend の federation/fediverse/follows.ts。 */
export const followerRepository = {
    async get(userId: string, actorId: string): Promise<FollowerRecord | undefined> {
        const [row] = await db.select().from(federationFollowers).where(pairOf(userId, actorId));
        return row;
    },

    /**
     * 2 人のフォローをロックし、今の行を読んで `fn` を実行する（1 トランザクション。`fn` が投げたら書き込みは戻る）。
     * Follow と Undo、承認と取り消しが同時に届いても、片方の書き込みが消えないように。
     * `fn` の中では `write` だけで DB に触る（別の接続を待つと、接続を使い切ったときに全員が止まる）。
     */
    async locked<T>(
        userId: string,
        actorId: string,
        fn: (current: FollowerRecord | undefined, write: FollowerWriter) => Promise<T>,
    ): Promise<T> {
        return db.transaction(async (tx) => {
            await tx.execute(
                sql`select pg_advisory_xact_lock(hashtextextended(${`federation_followers:${userId}\n${actorId}`}, 0))`,
            );
            const [current] = await tx.select().from(federationFollowers).where(pairOf(userId, actorId));
            return fn(current, {
                async put(input, now) {
                    const values = { ...input, updatedAt: now };
                    const [row] = await tx
                        .insert(federationFollowers)
                        .values({ ...values, userId, actorId, createdAt: now })
                        .onConflictDoUpdate({
                            target: [federationFollowers.userId, federationFollowers.actorId],
                            set: values,
                        })
                        .returning();
                    if (!row) throw new Error('フォローを保存できません');
                    return row;
                },
                async remove() {
                    await tx.delete(federationFollowers).where(pairOf(userId, actorId));
                },
                countPending: () => countPendingOf(tx, userId),
                enqueue: (delivery, now) => deliveryRepository.enqueue(delivery, now, tx),
            });
        });
    },

    /** その Follow の行（Undo の object の id で引く）。 */
    async findByFollowId(followId: string): Promise<FollowerRecord[]> {
        return db.select().from(federationFollowers).where(eq(federationFollowers.followId, followId));
    },

    /** ユーザーのフォロワー（actor の表示の情報付き。新しい順。消えた actor は除く）。 */
    async listForUser(userId: string, state: FollowerState, limit: number): Promise<FollowerWithActor[]> {
        const rows = await db
            .select({
                follower: federationFollowers,
                account: remoteActors.account,
                name: remoteActors.name,
                icon: remoteActors.icon,
                url: remoteActors.url,
                profile: remoteActors.profile,
            })
            .from(federationFollowers)
            .innerJoin(remoteActors, eq(remoteActors.id, federationFollowers.actorId))
            .where(
                and(
                    eq(federationFollowers.userId, userId),
                    eq(federationFollowers.state, state),
                    isNull(remoteActors.deletedAt),
                ),
            )
            .orderBy(desc(federationFollowers.updatedAt))
            .limit(limit);
        return rows.map((r) => ({
            ...r.follower,
            account: r.account,
            name: r.name,
            icon: r.icon,
            url: r.url,
            profile: r.profile,
        }));
    },

    /** フォロワーの数（消えた actor は除く）。 */
    async countAccepted(userId: string): Promise<number> {
        const [row] = await db
            .select({ n: count() })
            .from(federationFollowers)
            .innerJoin(remoteActors, eq(remoteActors.id, federationFollowers.actorId))
            .where(
                and(
                    eq(federationFollowers.userId, userId),
                    eq(federationFollowers.state, 'accepted'),
                    isNull(remoteActors.deletedAt),
                ),
            );
        return row?.n ?? 0;
    },

    countPending: (userId: string) => countPendingOf(db, userId),

    /** フォロワーの actor（届け先を決める。消えた actor は除く）。 */
    async acceptedActorsOf(userId: string): Promise<RemoteActorRecord[]> {
        const rows = await db
            .select({ actor: remoteActors })
            .from(federationFollowers)
            .innerJoin(remoteActors, eq(remoteActors.id, federationFollowers.actorId))
            .where(
                and(
                    eq(federationFollowers.userId, userId),
                    eq(federationFollowers.state, 'accepted'),
                    isNull(remoteActors.deletedAt),
                ),
            );
        return rows.map((r) => r.actor);
    },

    /** 承認待ちの actor の id（承認制をやめたとき、まとめて承認する）。 */
    async pendingActorIdsOf(userId: string): Promise<string[]> {
        const rows = await db
            .select({ actorId: federationFollowers.actorId })
            .from(federationFollowers)
            .where(and(eq(federationFollowers.userId, userId), eq(federationFollowers.state, 'pending')));
        return rows.map((r) => r.actorId);
    },

    /** この actor のフォローをすべて消す（actor が消えた）。消した行を返す。 */
    async removeAllFor(actorId: string): Promise<FollowerRecord[]> {
        return db.delete(federationFollowers).where(eq(federationFollowers.actorId, actorId)).returning();
    },

    /** 消えた actor のフォローを消す（消えた知らせの処理と行き違って書かれたもの）。 */
    async removeForDeletedActors(): Promise<FollowerRecord[]> {
        const gone = db.select({ id: remoteActors.id }).from(remoteActors).where(isNotNull(remoteActors.deletedAt));
        return db.delete(federationFollowers).where(inArray(federationFollowers.actorId, gone)).returning();
    },

    /** ドメイン（ポート違い・サブドメインも）の actor のフォローをすべて消す（連合しないと決めたとき）。 */
    async removeForDomain(domain: string): Promise<FollowerRecord[]> {
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
        return db.delete(federationFollowers).where(inArray(federationFollowers.actorId, actors)).returning();
    },
};
