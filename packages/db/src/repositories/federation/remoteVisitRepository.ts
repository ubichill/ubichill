import type { RoomCard } from '@ubichill/shared';
import { and, eq, gte, inArray, lt } from 'drizzle-orm';
import { db } from '../../index';
import { remoteVisits } from '../../schema';

export interface RemoteVisitRecord {
    userId: string;
    roomUrl: string;
    room: RoomCard;
    updatedAt: Date;
}

/** このサーバーのユーザーが、ほかのサーバーの部屋に来訪している（現在地の答えに使う）。 */
export const remoteVisitRepository = {
    async set(userId: string, roomUrl: string, room: RoomCard, now: Date): Promise<void> {
        await db
            .insert(remoteVisits)
            .values({ userId, roomUrl, room, updatedAt: now })
            .onConflictDoUpdate({ target: remoteVisits.userId, set: { roomUrl, room, updatedAt: now } });
    },

    /** 来訪を続けている知らせ。その部屋への来訪が記録されていれば true。 */
    async touch(userId: string, roomUrl: string, now: Date): Promise<boolean> {
        const rows = await db
            .update(remoteVisits)
            .set({ updatedAt: now })
            .where(and(eq(remoteVisits.userId, userId), eq(remoteVisits.roomUrl, roomUrl)))
            .returning({ userId: remoteVisits.userId });
        return rows.length > 0;
    },

    /** since より後に知らせのあった、その人の来訪。 */
    async get(userId: string, since: Date): Promise<RemoteVisitRecord | undefined> {
        const [row] = await db
            .select()
            .from(remoteVisits)
            .where(and(eq(remoteVisits.userId, userId), gte(remoteVisits.updatedAt, since)));
        return row && { ...row, room: row.room as RoomCard };
    },

    async clear(userId: string): Promise<void> {
        await db.delete(remoteVisits).where(eq(remoteVisits.userId, userId));
    },

    /** since より後に知らせのあった来訪。 */
    async listFresh(userIds: readonly string[], since: Date): Promise<RemoteVisitRecord[]> {
        if (userIds.length === 0) return [];
        const rows = await db
            .select()
            .from(remoteVisits)
            .where(and(inArray(remoteVisits.userId, [...userIds]), gte(remoteVisits.updatedAt, since)));
        return rows.map((r) => ({ ...r, room: r.room as RoomCard }));
    },

    async deleteStale(before: Date): Promise<number> {
        const rows = await db
            .delete(remoteVisits)
            .where(lt(remoteVisits.updatedAt, before))
            .returning({ userId: remoteVisits.userId });
        return rows.length;
    },
};
