import type { ModLock, WorldSignature } from '@ubichill/shared';
import { and, count, eq } from 'drizzle-orm';
import { db } from '../index';
import { worlds } from '../schema';

export interface CreateWorldInput {
    authorId: string;
    /** URL の ID（サーバーが作る）。 */
    name: string;
    /** 作者が付けた名前（metadata.name）。 */
    worldName: string;
    version: string;
    definition: unknown;
    /** mod 完全性ロック（definition とは別カラムに保存）。 */
    lock?: ModLock | null;
    /** 作者の署名（保存前に検証済みのもの）。 */
    signature?: WorldSignature | null;
}

export interface UpdateWorldInput {
    name?: string;
    version?: string;
    definition?: unknown;
    lock?: ModLock | null;
    signature?: WorldSignature | null;
    draftDefinition?: unknown;
    draftLock?: ModLock | null;
    draftUpdatedAt?: Date | null;
}

export type WorldRecord = typeof worlds.$inferSelect;
export type InsertWorldRecord = typeof worlds.$inferInsert;

/**
 * ワールドリポジトリ
 * DBへのワールドCRUD操作を提供
 */
export const worldRepository = {
    /**
     * すべてのワールドを取得
     */
    async findAll(): Promise<WorldRecord[]> {
        return db.select().from(worlds);
    },

    /**
     * IDでワールドを取得
     */
    async findById(id: string): Promise<WorldRecord | undefined> {
        const results = await db.select().from(worlds).where(eq(worlds.id, id));
        return results[0];
    },

    /**
     * 名前でワールドを取得
     */
    async findByName(name: string): Promise<WorldRecord | undefined> {
        const results = await db.select().from(worlds).where(eq(worlds.name, name));
        return results[0];
    },

    /** 作者と、作者が付けた名前でワールドを取得する（同じ作者・同じ名前は同じワールド）。 */
    async findByAuthorAndWorldName(authorId: string, worldName: string): Promise<WorldRecord | undefined> {
        const results = await db
            .select()
            .from(worlds)
            .where(and(eq(worlds.authorId, authorId), eq(worlds.worldName, worldName)));
        return results[0];
    },

    /**
     * 作成者IDでワールドを取得
     */
    async findByAuthorId(authorId: string): Promise<WorldRecord[]> {
        return db.select().from(worlds).where(eq(worlds.authorId, authorId));
    },

    /**
     * 作成者IDでワールド数をカウント（上限チェック用）
     */
    async countByAuthorId(authorId: string): Promise<number> {
        const result = await db.select({ value: count() }).from(worlds).where(eq(worlds.authorId, authorId));
        return result[0]?.value ?? 0;
    },

    /**
     * ワールドを作成
     */
    async create(input: CreateWorldInput): Promise<WorldRecord> {
        const results = await db
            .insert(worlds)
            .values({
                authorId: input.authorId,
                name: input.name,
                worldName: input.worldName,
                version: input.version,
                definition: input.definition,
                lock: input.lock ?? null,
                signature: input.signature ?? null,
            })
            .returning();
        return results[0];
    },

    /**
     * ワールドを更新
     */
    async update(id: string, input: UpdateWorldInput): Promise<WorldRecord | undefined> {
        const results = await db
            .update(worlds)
            .set({
                ...input,
                updatedAt: new Date(),
            })
            .where(eq(worlds.id, id))
            .returning();
        return results[0];
    },

    /**
     * ワールドを削除
     */
    async delete(id: string): Promise<boolean> {
        const results = await db.delete(worlds).where(eq(worlds.id, id)).returning();
        return results.length > 0;
    },
};
