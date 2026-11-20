import { asc, eq, sql } from 'drizzle-orm';
import { db } from '../index';
import { featuredFediverseServers } from '../schema';
import type { Tx } from './credentialUser';

export type AddFeaturedServerOutcome = 'added' | 'exists' | 'full';

/** 並べるサーバーの変更を直列にする（数えてから足す・並べ替えで、同時の操作に数や順を崩させない）。 */
const lockList = (tx: Tx) =>
    tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('featured_fediverse_servers', 0))`);

const hostsOf = async (tx: Tx): Promise<string[]> =>
    (
        await tx
            .select({ host: featuredFediverseServers.host })
            .from(featuredFediverseServers)
            .orderBy(asc(featuredFediverseServers.position), asc(featuredFediverseServers.host))
    ).map((row) => row.host);

/** ログイン画面に並べるサーバー（コントロールパネルの「認証」）。 */
export const featuredServerRepository = {
    /** 並べる順のホスト */
    async list(): Promise<string[]> {
        return db.transaction((tx) => hostsOf(tx));
    },

    /** 末尾に足す。`max` 件あれば足さない。 */
    async add(host: string, max: number): Promise<AddFeaturedServerOutcome> {
        return db.transaction(async (tx) => {
            await lockList(tx);
            const hosts = await hostsOf(tx);
            if (hosts.includes(host)) return 'exists';
            if (hosts.length >= max) return 'full';
            const [row] = await tx
                .select({ last: sql<number | null>`max(${featuredFediverseServers.position})` })
                .from(featuredFediverseServers);
            await tx.insert(featuredFediverseServers).values({ host, position: (row?.last ?? -1) + 1 });
            return 'added';
        });
    },

    /** 外す。無ければ false。 */
    async remove(host: string): Promise<boolean> {
        const removed = await db
            .delete(featuredFediverseServers)
            .where(eq(featuredFediverseServers.host, host))
            .returning({ host: featuredFediverseServers.host });
        return removed.length > 0;
    },

    /**
     * 並べ替える。`hosts` は今の一覧を並べ替えたもの（足し引きは別の操作）。違えば 'mismatch'（ほかの管理者が
     * 同時に足した・外した。画面に読み直させる）。
     */
    async reorder(hosts: readonly string[]): Promise<'reordered' | 'mismatch'> {
        return db.transaction(async (tx) => {
            await lockList(tx);
            const current = await hostsOf(tx);
            const same = current.length === hosts.length && new Set(hosts).size === hosts.length;
            if (!same || !hosts.every((host) => current.includes(host))) return 'mismatch' as const;
            for (const [position, host] of hosts.entries()) {
                await tx
                    .update(featuredFediverseServers)
                    .set({ position })
                    .where(eq(featuredFediverseServers.host, host));
            }
            return 'reordered' as const;
        });
    },
};
