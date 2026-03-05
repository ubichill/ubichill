import type { WorldDefinition } from '@ubichill/shared';
import { eq } from 'drizzle-orm';
import { db } from '../index';
import { worlds } from '../schema';

export interface CreateWorldInput {
    authorId: string;
    name: string;
    version: string;
    definition: WorldDefinition;
}

export interface UpdateWorldInput {
    name?: string;
    version?: string;
    definition?: WorldDefinition;
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

    /**
     * 作成者IDでワールドを取得
     */
    async findByAuthorId(authorId: string): Promise<WorldRecord[]> {
        return db.select().from(worlds).where(eq(worlds.authorId, authorId));
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
                version: input.version,
                definition: input.definition,
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

    /**
     * 名前でワールドを upsert（存在すれば更新、なければ作成）
     */
    async upsertByName(input: CreateWorldInput): Promise<WorldRecord> {
        const existing = await this.findByName(input.name);
        if (existing) {
            const updated = await this.update(existing.id, {
                version: input.version,
                definition: input.definition,
            });
            // updateは既存レコードを更新するので、必ずWorldRecordが返る
            if (!updated) {
                throw new Error(`Failed to update world: ${input.name}`);
            }
            return updated;
        }
        return this.create(input);
    },
};
