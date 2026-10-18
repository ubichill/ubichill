import { createHash } from 'node:crypto';
import { type WorldCrypto, worldContentHash } from '@ubichill/shared';
import { and, eq, isNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { worldVersions } from './schema/worlds';

/** ハッシュだけに使う（署名の検証はしない）。 */
const hashOnlyCrypto: WorldCrypto = {
    sha256Base64: async (text) => createHash('sha256').update(text, 'utf8').digest('base64'),
    verifyEd25519: async () => false,
};

/** 版の content_hash（shared の worldContentHash()。lock が無ければ null として計算する）。 */
export function versionContentHash(definition: unknown, lock: unknown): Promise<string> {
    return worldContentHash({ definition, lock: lock ?? null }, hashOnlyCrypto);
}

/**
 * content_hash が空の版を埋める（0023 で移した行）。何度呼んでもよい。埋めた数を返す。
 * SQL では worldContentHash() と同じ値を作れないので、マイグレーションの直後に migrate.js から呼ぶ。
 */
export async function backfillWorldContentHashes<TSchema extends Record<string, unknown>>(
    database: PostgresJsDatabase<TSchema>,
): Promise<number> {
    const rows = await database
        .select({ id: worldVersions.id, definition: worldVersions.definition, lock: worldVersions.lock })
        .from(worldVersions)
        .where(isNull(worldVersions.contentHash));
    const updated = await Promise.all(
        rows.map(async (row) => {
            const contentHash = await versionContentHash(row.definition, row.lock);
            const result = await database
                .update(worldVersions)
                .set({ contentHash })
                .where(and(eq(worldVersions.id, row.id), isNull(worldVersions.contentHash)))
                .returning({ id: worldVersions.id });
            return result.length;
        }),
    );
    return updated.reduce((a, b) => a + b, 0);
}
