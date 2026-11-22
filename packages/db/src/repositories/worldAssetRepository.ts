import { WORLD_ASSET_REFERENCE_PATTERN } from '@ubichill/shared';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '../index';
import { worldAssets, worldDrafts, worldVersions } from '../schema';

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

export interface RemovedWorldAsset {
    ownerId: string;
    hash: string;
    byteSize: number;
}

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
     * 上限の内なら足す。同じ人が同じ画像を上げ直したときは数えず、created_at だけ今にする
     * （使われていない画像の掃除の猶予を数え直す。上げ直してまだ保存していない画像を消さない）。
     * 同じ人の同時のアップロードで上限を越えないよう、持ち主ごとに順番に数える。
     */
    async add(
        ownerId: string,
        image: WorldAssetBlob,
        quota: { count: number; bytes: number },
    ): Promise<AddWorldAssetOutcome> {
        return db.transaction(async (tx) => {
            await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`world-assets:${ownerId}`}, 0))`);
            // 掃除が同じ行を消している途中なら、消し終わるのを待って 0 行になり、下で足し直す
            const [existing] = await tx
                .update(worldAssets)
                .set({ createdAt: sql`now()` })
                .where(and(eq(worldAssets.ownerId, ownerId), eq(worldAssets.hash, image.hash)))
                .returning({ hash: worldAssets.hash });
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

    /**
     * created_at が cutoff より前で、このサーバーのどのワールドの定義（下書き・版）にも出てこない画像を limit 枚まで消し、
     * 消したものを返す。だれのワールドから指されていても残す（複製したワールドはほかの人の画像を指す）。
     * 定義は 1 回だけ読んでハッシュを抜き出す（画像ごとに全部の定義を探すと、画像の数 × 定義の大きさになる）。
     * 掃除と同時の上げ直し（created_at を今にする）が先に終われば、DELETE が行を読み直して消さない。
     */
    async removeUnreferenced(cutoff: Date, limit: number): Promise<RemovedWorldAsset[]> {
        const rows = await db.execute<{ owner_id: string; hash: string; byte_size: number }>(sql`
            WITH referenced AS MATERIALIZED (
                SELECT DISTINCT m[1] AS hash
                FROM (
                    SELECT ${worldDrafts.definition}::text AS body FROM ${worldDrafts}
                    UNION ALL
                    SELECT ${worldVersions.definition}::text AS body FROM ${worldVersions}
                ) d
                CROSS JOIN LATERAL regexp_matches(d.body, ${WORLD_ASSET_REFERENCE_PATTERN}, 'g') AS m
            ),
            doomed AS (
                SELECT a.owner_id, a.hash FROM ${worldAssets} a
                WHERE a.created_at < ${cutoff.toISOString()}::timestamptz
                  AND NOT EXISTS (SELECT 1 FROM referenced r WHERE r.hash = a.hash)
                LIMIT ${limit}
                FOR UPDATE SKIP LOCKED
            )
            DELETE FROM ${worldAssets} a USING doomed
            WHERE a.owner_id = doomed.owner_id AND a.hash = doomed.hash
              AND a.created_at < ${cutoff.toISOString()}::timestamptz
            RETURNING a.owner_id, a.hash, a.byte_size`);
        return rows.map((row) => ({ ownerId: row.owner_id, hash: row.hash, byteSize: row.byte_size }));
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
