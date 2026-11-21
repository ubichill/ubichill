import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '../index';
import { worldAssets } from '../schema';

export interface WorldAssetBlob {
    hash: string;
    bytes: Uint8Array;
    width: number;
    height: number;
}

export interface WorldAssetRecord {
    hash: string;
    width: number;
    height: number;
    byteSize: number;
    createdAt: Date;
}

export type AddWorldAssetOutcome = 'added' | 'exists' | 'over-quota';

const metadata = {
    hash: worldAssets.hash,
    width: worldAssets.width,
    height: worldAssets.height,
    byteSize: worldAssets.byteSize,
    createdAt: worldAssets.createdAt,
};

/** ワールドの作者が上げた画像。 */
export const worldAssetRepository = {
    /**
     * 上限の内なら足す。同じ人が同じ画像を上げ直したときは何もしない（数えない）。
     * 同じ人の同時のアップロードで上限を越えないよう、持ち主ごとに順番に数える。
     */
    async add(
        ownerId: string,
        image: WorldAssetBlob,
        quota: { count: number; bytes: number },
    ): Promise<AddWorldAssetOutcome> {
        return db.transaction(async (tx) => {
            await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`world-assets:${ownerId}`}, 0))`);
            const [existing] = await tx
                .select({ hash: worldAssets.hash })
                .from(worldAssets)
                .where(and(eq(worldAssets.ownerId, ownerId), eq(worldAssets.hash, image.hash)));
            if (existing) return 'exists';
            const [usage] = await tx
                .select({
                    count: sql<number>`count(*)::int`,
                    bytes: sql<number>`coalesce(sum(${worldAssets.byteSize}), 0)::bigint`,
                })
                .from(worldAssets)
                .where(eq(worldAssets.ownerId, ownerId));
            if (
                (usage?.count ?? 0) + 1 > quota.count ||
                Number(usage?.bytes ?? 0) + image.bytes.byteLength > quota.bytes
            ) {
                return 'over-quota';
            }
            await tx.insert(worldAssets).values({
                ownerId,
                hash: image.hash,
                bytes: Buffer.from(image.bytes.buffer, image.bytes.byteOffset, image.bytes.byteLength),
                byteSize: image.bytes.byteLength,
                width: image.width,
                height: image.height,
            });
            return 'added';
        });
    },

    /** 配信する中身（だれが上げたものでも、同じハッシュなら同じ中身）。 */
    async findByHash(hash: string): Promise<WorldAssetBlob | undefined> {
        const [row] = await db
            .select({
                hash: worldAssets.hash,
                bytes: worldAssets.bytes,
                width: worldAssets.width,
                height: worldAssets.height,
            })
            .from(worldAssets)
            .where(eq(worldAssets.hash, hash))
            .limit(1);
        return row ? { ...row, bytes: new Uint8Array(row.bytes) } : undefined;
    },

    async find(ownerId: string, hash: string): Promise<WorldAssetRecord | undefined> {
        const [row] = await db
            .select(metadata)
            .from(worldAssets)
            .where(and(eq(worldAssets.ownerId, ownerId), eq(worldAssets.hash, hash)));
        return row;
    },

    /** 持ち主の画像（新しい順）。 */
    async listByOwner(ownerId: string): Promise<WorldAssetRecord[]> {
        return db
            .select(metadata)
            .from(worldAssets)
            .where(eq(worldAssets.ownerId, ownerId))
            .orderBy(desc(worldAssets.createdAt));
    },

    /** 消せたら true。ほかの人が同じ画像を上げていれば、その人の分は残る（URL は使い続けられる）。 */
    async remove(ownerId: string, hash: string): Promise<boolean> {
        const rows = await db
            .delete(worldAssets)
            .where(and(eq(worldAssets.ownerId, ownerId), eq(worldAssets.hash, hash)))
            .returning({ hash: worldAssets.hash });
        return rows.length > 0;
    },
};
