import { eq, sql } from 'drizzle-orm';
import { db } from '../../index';
import { remoteServers } from '../../schema';

export type RemoteServerRecord = typeof remoteServers.$inferSelect;

/** 知っているほかのサーバーと、配送の調子。 */
export const remoteServerRepository = {
    /** 連絡がついた（無ければ記録する）。 */
    async touch(domain: string, now: Date): Promise<void> {
        await db
            .insert(remoteServers)
            .values({ domain, firstSeenAt: now, lastSeenAt: now })
            .onConflictDoUpdate({ target: remoteServers.domain, set: { lastSeenAt: now } });
    },

    /** NodeInfo・Application actor から分かったこと。 */
    async setInfo(
        domain: string,
        info: { software: string | null; version: string | null; federationVersion: number | null; features: string[] },
        now: Date,
    ): Promise<void> {
        const values = { ...info, nodeInfoFetchedAt: now, lastSeenAt: now };
        await db
            .insert(remoteServers)
            .values({ domain, firstSeenAt: now, ...values })
            .onConflictDoUpdate({ target: remoteServers.domain, set: values });
    },

    async recordSuccess(domain: string, now: Date): Promise<void> {
        await db
            .insert(remoteServers)
            .values({ domain, firstSeenAt: now, lastSeenAt: now, lastSuccessAt: now })
            .onConflictDoUpdate({
                target: remoteServers.domain,
                set: {
                    lastSeenAt: now,
                    lastSuccessAt: now,
                    failingSince: null,
                    consecutiveFailures: 0,
                    pausedUntil: null,
                },
            });
    },

    /** 失敗を数え、続けて何回目かを返す。pausedUntil を渡せば、その時刻まで送らない。 */
    async recordFailure(domain: string, now: Date, pausedUntil?: (failures: number) => Date | null): Promise<number> {
        const [row] = await db
            .insert(remoteServers)
            .values({ domain, firstSeenAt: now, lastSeenAt: now, failingSince: now, consecutiveFailures: 1 })
            .onConflictDoUpdate({
                target: remoteServers.domain,
                set: {
                    failingSince: sql`coalesce(${remoteServers.failingSince}, ${now.toISOString()}::timestamptz)`,
                    consecutiveFailures: sql`${remoteServers.consecutiveFailures} + 1`,
                },
            })
            .returning({ failures: remoteServers.consecutiveFailures });
        const failures = row?.failures ?? 1;
        const until = pausedUntil?.(failures) ?? null;
        if (until) await db.update(remoteServers).set({ pausedUntil: until }).where(eq(remoteServers.domain, domain));
        return failures;
    },

    async get(domain: string): Promise<RemoteServerRecord | undefined> {
        const [row] = await db.select().from(remoteServers).where(eq(remoteServers.domain, domain));
        return row;
    },

    async list(): Promise<RemoteServerRecord[]> {
        return db.select().from(remoteServers).orderBy(remoteServers.domain);
    },
};
