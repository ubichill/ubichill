import type { ModLock, WorldSignature } from '@ubichill/shared';
import { and, count, eq, gt, inArray, notExists, sql } from 'drizzle-orm';
import { customAlphabet } from 'nanoid';
import { type Database, db } from '../index';
import { instances, worldDrafts, worldNameAliases, worlds, worldVersions } from '../schema';
import { versionContentHash } from '../worldContentHashBackfill';
import {
    definitionVersionOf,
    versionsToPrune,
    type WorldRecord,
    type WorldState,
    type WorldVersionRecord,
} from './worldRows';

export type { WorldDraftRecord, WorldRecord, WorldState, WorldVersionRecord } from './worldRows';

// API の ID（/api/v1/worlds/:worldId）。0023 より前の name と同じ形（小文字と数字の 21 文字）にそろえる
const generateWorldId = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 21);

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/** どのワールドに保存するか。`worldId` が無ければ作る。あれば `worldName` に名前を変える（同じなら何もしない）。 */
export interface WorldTarget {
    authorId: string;
    worldName: string;
    worldId?: string;
}

export interface PublishInput {
    version: string;
    definition: unknown;
    lock: ModLock | null;
    signature: WorldSignature;
    /** shared の worldContentHash() の値（署名の検証で求めたもの）。 */
    contentHash: string;
}

/**
 * - published: 新しい版を足した
 * - resigned: 同じ version・同じ中身の版があったので、署名だけ置き換えて公開中にした
 * - version-conflict: 同じ version で中身の違う版がある（何も変えない）
 */
export type PublishOutcome =
    | { status: 'published' | 'resigned'; worldId: string; versionId: string }
    | { status: 'version-conflict'; version: string };

class VersionConflict extends Error {}

const worldColumns = {
    id: worlds.id,
    authorId: worlds.authorId,
    worldName: worlds.worldName,
    currentVersionId: worlds.currentVersionId,
    createdAt: worlds.createdAt,
    updatedAt: worlds.updatedAt,
};

/**
 * 0023 より前の列を、版と下書きから書き直す（古いイメージに戻したときに同じ中身が見えるように）。読まない。列を消すときに一緒に消す。
 * 公開中なら definition/lock/signature は公開中の版・draft_* は下書き、未公開なら definition/lock は下書き・署名なし。
 */
async function syncLegacyColumns(tx: Transaction, worldId: string): Promise<void> {
    await tx.execute(sql`
        UPDATE worlds w SET
            version = COALESCE(v.version, d.definition->'metadata'->>'version', w.version),
            definition = COALESCE(v.definition, d.definition, w.definition),
            lock = CASE WHEN v.id IS NOT NULL THEN v.lock WHEN d.world_id IS NOT NULL THEN d.lock ELSE w.lock END,
            signature = CASE WHEN v.id IS NOT NULL THEN v.signature WHEN d.world_id IS NOT NULL THEN NULL ELSE w.signature END,
            draft_definition = CASE WHEN v.id IS NOT NULL THEN d.definition END,
            draft_lock = CASE WHEN v.id IS NOT NULL THEN d.lock END,
            draft_updated_at = CASE WHEN v.id IS NOT NULL THEN d.updated_at END
        FROM worlds s
        LEFT JOIN world_versions v ON v.id = s.current_version_id
        LEFT JOIN world_drafts d ON d.world_id = s.id
        WHERE w.id = s.id AND w.id = ${worldId}
    `);
}

/** 保存先のワールドを決める（作成・名前の変更）。返すのはワールドの ID。 */
async function ensureWorld(tx: Transaction, target: WorldTarget, seed: { definition: unknown }): Promise<string> {
    if (!target.worldId) {
        // 以前ほかのワールドが使っていた名前なら、新しいワールドを優先する
        await tx
            .delete(worldNameAliases)
            .where(and(eq(worldNameAliases.authorId, target.authorId), eq(worldNameAliases.name, target.worldName)));
        const id = generateWorldId();
        await tx.insert(worlds).values({
            id,
            authorId: target.authorId,
            worldName: target.worldName,
            // 0023 より前の NOT NULL の列（syncLegacyColumns が書き直す）
            name: id,
            version: definitionVersionOf(seed.definition),
            definition: seed.definition,
        });
        return id;
    }
    const worldId = target.worldId;
    const [current] = await tx.select(worldColumns).from(worlds).where(eq(worlds.id, worldId)).for('update');
    if (!current) throw new Error(`ワールド ${worldId} がありません`);
    if (current.worldName !== target.worldName) {
        // 名前を変える: 以前の名前を別名に残し、新しい名前の古い別名は消す
        await tx
            .delete(worldNameAliases)
            .where(and(eq(worldNameAliases.authorId, current.authorId), eq(worldNameAliases.name, target.worldName)));
        await tx
            .insert(worldNameAliases)
            .values({ authorId: current.authorId, name: current.worldName, worldId })
            .onConflictDoUpdate({
                target: [worldNameAliases.authorId, worldNameAliases.name],
                set: { worldId, createdAt: new Date() },
            });
    }
    await tx.update(worlds).set({ worldName: target.worldName, updatedAt: new Date() }).where(eq(worlds.id, worldId));
    return worldId;
}

async function findStates(database: Database, where: ReturnType<typeof eq> | undefined): Promise<WorldState[]> {
    const rows = await database
        .select({ world: worldColumns, current: worldVersions, draft: worldDrafts })
        .from(worlds)
        .leftJoin(worldVersions, eq(worldVersions.id, worlds.currentVersionId))
        .leftJoin(worldDrafts, eq(worldDrafts.worldId, worlds.id))
        .where(where);
    return rows.map((r) => ({ world: r.world, current: r.current ?? undefined, draft: r.draft ?? undefined }));
}

/**
 * ワールドリポジトリ。中身は版（world_versions、変えない）と下書き（world_drafts）に分けて持つ。
 */
export const worldRepository = {
    async findAll(): Promise<WorldRecord[]> {
        return db.select(worldColumns).from(worlds);
    },

    async findById(id: string): Promise<WorldRecord | undefined> {
        const results = await db.select(worldColumns).from(worlds).where(eq(worlds.id, id));
        return results[0];
    },

    /** ワールドと、公開中の版・下書き。 */
    async findState(id: string): Promise<WorldState | undefined> {
        return (await findStates(db, eq(worlds.id, id)))[0];
    },

    async findStatesByAuthorId(authorId: string): Promise<WorldState[]> {
        return findStates(db, eq(worlds.authorId, authorId));
    },

    /** 作者と、作者が付けた名前でワールドを取得する（同じ作者・同じ名前は同じワールド）。 */
    async findByAuthorAndWorldName(authorId: string, worldName: string): Promise<WorldRecord | undefined> {
        const results = await db
            .select(worldColumns)
            .from(worlds)
            .where(and(eq(worlds.authorId, authorId), eq(worlds.worldName, worldName)));
        return results[0];
    },

    /** 以前の名前（名前を変える前の URL）からワールドを取得する。 */
    async findByAuthorAndAlias(authorId: string, name: string): Promise<WorldRecord | undefined> {
        const results = await db
            .select({ world: worldColumns })
            .from(worldNameAliases)
            .innerJoin(worlds, eq(worlds.id, worldNameAliases.worldId))
            .where(and(eq(worldNameAliases.authorId, authorId), eq(worldNameAliases.name, name)));
        return results[0]?.world;
    },

    async findByAuthorId(authorId: string): Promise<WorldRecord[]> {
        return db.select(worldColumns).from(worlds).where(eq(worlds.authorId, authorId));
    },

    /** 作成者IDでワールド数をカウント（上限チェック用） */
    async countByAuthorId(authorId: string): Promise<number> {
        const result = await db.select({ value: count() }).from(worlds).where(eq(worlds.authorId, authorId));
        return result[0]?.value ?? 0;
    },

    /** 残っている版を content_hash で引く（消した版は無い）。 */
    async findVersionByContentHash(worldId: string, contentHash: string): Promise<WorldVersionRecord | undefined> {
        const results = await db
            .select()
            .from(worldVersions)
            .where(and(eq(worldVersions.worldId, worldId), eq(worldVersions.contentHash, contentHash)));
        return results[0];
    },

    async listVersions(worldId: string): Promise<WorldVersionRecord[]> {
        return db.select().from(worldVersions).where(eq(worldVersions.worldId, worldId));
    },

    /**
     * 公開する。版を 1 行足し（同じ version・同じ中身なら署名だけ置き換え）、公開中を付け替え、下書きを消すまでを 1 トランザクションで行う。
     * 公開中の版と同じ中身への署名し直しなら下書きは残す。古い版はここでは消さない（{@link pruneVersions}）。
     */
    async publish(target: WorldTarget, input: PublishInput): Promise<PublishOutcome> {
        try {
            return await db.transaction(async (tx) => {
                const worldId = await ensureWorld(tx, target, input);
                const [previous] = await tx
                    .select({ contentHash: worldVersions.contentHash })
                    .from(worlds)
                    .innerJoin(worldVersions, eq(worldVersions.id, worlds.currentVersionId))
                    .where(eq(worlds.id, worldId));
                const [sameVersion] = await tx
                    .select()
                    .from(worldVersions)
                    .where(and(eq(worldVersions.worldId, worldId), eq(worldVersions.version, input.version)))
                    .for('update');
                const sameVersionHash = sameVersion
                    ? (sameVersion.contentHash ?? (await versionContentHash(sameVersion.definition, sameVersion.lock)))
                    : undefined;
                if (sameVersion && sameVersionHash !== input.contentHash) throw new VersionConflict();
                const versionId = sameVersion
                    ? sameVersion.id
                    : (
                          await tx
                              .insert(worldVersions)
                              .values({
                                  worldId,
                                  version: input.version,
                                  definition: input.definition,
                                  lock: input.lock,
                                  signature: input.signature,
                                  contentHash: input.contentHash,
                              })
                              .returning({ id: worldVersions.id })
                      )[0]?.id;
                if (!versionId) throw new Error('版を保存できませんでした');
                if (sameVersion) {
                    // 版を変えない例外: 同じ中身への署名し直しだけは signature の列を置き換える
                    await tx
                        .update(worldVersions)
                        .set({
                            signature: input.signature,
                            ...(sameVersion.contentHash ? {} : { contentHash: input.contentHash }),
                        })
                        .where(eq(worldVersions.id, versionId));
                }
                if (previous?.contentHash !== input.contentHash) {
                    await tx.delete(worldDrafts).where(eq(worldDrafts.worldId, worldId));
                }
                await tx
                    .update(worlds)
                    .set({ currentVersionId: versionId, updatedAt: new Date() })
                    .where(eq(worlds.id, worldId));
                await syncLegacyColumns(tx, worldId);
                return { status: sameVersion ? 'resigned' : 'published', worldId, versionId } as const;
            });
        } catch (err) {
            if (err instanceof VersionConflict) return { status: 'version-conflict', version: input.version };
            throw err;
        }
    },

    /**
     * 下書きを保存する。`unpublish` なら公開中を外す（過去の版は残す）。外すと下書きを署名なしとして配る。
     * 返すのはワールドの ID。
     */
    async saveDraft(
        target: WorldTarget,
        input: { definition: unknown; lock: ModLock | null; unpublish: boolean },
    ): Promise<string> {
        return db.transaction(async (tx) => {
            const worldId = await ensureWorld(tx, target, input);
            const now = new Date();
            await tx
                .insert(worldDrafts)
                .values({ worldId, definition: input.definition, lock: input.lock, updatedAt: now })
                .onConflictDoUpdate({
                    target: worldDrafts.worldId,
                    set: { definition: input.definition, lock: input.lock, updatedAt: now },
                });
            if (input.unpublish) {
                await tx.update(worlds).set({ currentVersionId: null }).where(eq(worlds.id, worldId));
            }
            await syncLegacyColumns(tx, worldId);
            return worldId;
        });
    },

    /**
     * 残す数を超えた古い版を消す。インスタンスが指している版は消さない（次の公開か定期処理で消し直す）。消した数を返す。
     * インスタンスの作成と同時になると外部キー（RESTRICT）で失敗することがある。呼び出し側で失敗を握りつぶしてよい。
     */
    async pruneVersions(worldId: string, maxVersions: number): Promise<number> {
        const [world] = await db
            .select({ currentVersionId: worlds.currentVersionId })
            .from(worlds)
            .where(eq(worlds.id, worldId));
        if (!world) return 0;
        const versions = await db
            .select({ id: worldVersions.id, publishedAt: worldVersions.publishedAt })
            .from(worldVersions)
            .where(eq(worldVersions.worldId, worldId));
        const candidates = versionsToPrune(versions, world.currentVersionId, maxVersions);
        if (candidates.length === 0) return 0;
        const deleted = await db
            .delete(worldVersions)
            .where(
                and(
                    eq(worldVersions.worldId, worldId),
                    inArray(worldVersions.id, candidates),
                    notExists(
                        db
                            .select({ one: sql`1` })
                            .from(instances)
                            .where(eq(instances.worldVersionId, worldVersions.id)),
                    ),
                ),
            )
            .returning({ id: worldVersions.id });
        return deleted.length;
    },

    /** 版が 2 つ以上あるワールド（定期処理で {@link pruneVersions} をかける対象）。 */
    async findWorldsWithOldVersions(): Promise<Array<{ id: string; authorId: string }>> {
        return db
            .select({ id: worlds.id, authorId: worlds.authorId })
            .from(worlds)
            .innerJoin(worldVersions, eq(worldVersions.worldId, worlds.id))
            .groupBy(worlds.id, worlds.authorId)
            .having(gt(count(worldVersions.id), 1));
    },

    /**
     * ワールドを削除する。版を指すインスタンスは版の参照だけ外す（ワールドごと消すので、インスタンスはもう解決できない。
     * 0023 より前と同じく、インスタンスの行は reaper が消す）。
     */
    async delete(id: string): Promise<boolean> {
        return db.transaction(async (tx) => {
            await tx
                .update(instances)
                .set({ worldVersionId: null })
                .where(
                    inArray(
                        instances.worldVersionId,
                        tx.select({ id: worldVersions.id }).from(worldVersions).where(eq(worldVersions.worldId, id)),
                    ),
                );
            const results = await tx.delete(worlds).where(eq(worlds.id, id)).returning({ id: worlds.id });
            return results.length > 0;
        });
    },
};
