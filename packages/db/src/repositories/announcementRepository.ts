import type { FeedPosition } from '@ubichill/shared';
import { and, count, desc, eq, gt, gte, inArray, lt, max, or, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db } from '../index';
import { announcementReads, announcements, users } from '../schema';

export interface AnnouncementRecord {
    id: string;
    authorId: string | null;
    authorName: string | null;
    authorHandle: string | null;
    authorImage: string | null;
    title: string;
    content: string;
    publishedAt: Date;
}

const selection = {
    id: announcements.id,
    authorId: announcements.authorId,
    authorName: users.name,
    authorHandle: users.handle,
    authorImage: users.image,
    title: announcements.title,
    content: announcements.content,
    publishedAt: announcements.publishedAt,
};

const olderThan = (p: FeedPosition) =>
    or(
        lt(announcements.publishedAt, new Date(p.publishedMs)),
        and(eq(announcements.publishedAt, new Date(p.publishedMs)), lt(announcements.id, p.id)),
    );

/**
 * 運営からのお知らせ。利用者ごとの行は作らず、「この時刻までのお知らせは読んだ」位置（announcement_reads）と合わせて読む。
 * 位置の行が無い人は、登録した時刻を位置とする（登録より前のお知らせを未読にしない）。
 */
export const announcementRepository = {
    async create(input: { authorId: string; title: string; content: string }, now = new Date()) {
        const id = nanoid();
        await db.insert(announcements).values({ id, ...input, publishedAt: now });
        const [row] = await db
            .select(selection)
            .from(announcements)
            .leftJoin(users, eq(users.id, announcements.authorId))
            .where(eq(announcements.id, id));
        return row as AnnouncementRecord;
    },

    /** 新しい順。since 以降に出したもので、before より古いものだけ。 */
    async listPage(options: { since: Date; before?: FeedPosition; limit: number }): Promise<AnnouncementRecord[]> {
        return db
            .select(selection)
            .from(announcements)
            .leftJoin(users, eq(users.id, announcements.authorId))
            .where(
                and(
                    gte(announcements.publishedAt, options.since),
                    options.before ? olderThan(options.before) : undefined,
                ),
            )
            .orderBy(desc(announcements.publishedAt), desc(announcements.id))
            .limit(options.limit);
    },

    async findByIds(ids: readonly string[]): Promise<Array<{ id: string; publishedAt: Date }>> {
        if (ids.length === 0) return [];
        return db
            .select({ id: announcements.id, publishedAt: announcements.publishedAt })
            .from(announcements)
            .where(inArray(announcements.id, [...ids]));
    },

    async latestPublishedAt(): Promise<Date | undefined> {
        const [row] = await db.select({ at: max(announcements.publishedAt) }).from(announcements);
        return row?.at ?? undefined;
    },

    /** どこまで読んだか（位置の行が無ければ登録した時刻。ユーザーがいなければ undefined）。 */
    async readUntil(userId: string): Promise<Date | undefined> {
        const [row] = await db
            .select({
                at: sql<Date>`coalesce(${announcementReads.readUntil}, ${users.createdAt})`.mapWith(
                    (v: string | Date) => new Date(v),
                ),
            })
            .from(users)
            .leftJoin(announcementReads, eq(announcementReads.userId, users.id))
            .where(eq(users.id, userId));
        return row?.at;
    },

    /** 位置を進める（戻さない）。 */
    async advanceReadUntil(userId: string, until: Date): Promise<void> {
        await db
            .insert(announcementReads)
            .values({ userId, readUntil: until })
            .onConflictDoUpdate({
                target: announcementReads.userId,
                set: { readUntil: sql`greatest(${announcementReads.readUntil}, excluded.read_until)` },
            });
    },

    /** 位置より後に出した（読んでいない）お知らせの数。since より古いものは数えない。 */
    async countAfter(readUntil: Date, since: Date): Promise<number> {
        const [row] = await db
            .select({ n: count() })
            .from(announcements)
            .where(and(gt(announcements.publishedAt, readUntil), gte(announcements.publishedAt, since)));
        return row?.n ?? 0;
    },

    async deleteExpired(cutoff: Date): Promise<number> {
        const rows = await db
            .delete(announcements)
            .where(lt(announcements.publishedAt, cutoff))
            .returning({ id: announcements.id });
        return rows.length;
    },
};
