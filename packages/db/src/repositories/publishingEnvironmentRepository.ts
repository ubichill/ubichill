import { randomUUID } from 'node:crypto';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { db } from '../index';
import { publishingEnvironments } from '../schema';

export type PublishingEnvironmentRecord = typeof publishingEnvironments.$inferSelect;

export interface CreatePublishingEnvironmentInput {
    userId: string;
    kind: string;
    name: string;
    publicKey: string;
    apiTokenHash?: string;
}

export const publishingEnvironmentRepository = {
    /** 取り消したものも含む（鍵一覧の公開・管理画面用）。 */
    async listByUser(userId: string): Promise<PublishingEnvironmentRecord[]> {
        return db
            .select()
            .from(publishingEnvironments)
            .where(eq(publishingEnvironments.userId, userId))
            .orderBy(asc(publishingEnvironments.createdAt));
    },

    async findByPublicKey(publicKey: string): Promise<PublishingEnvironmentRecord | undefined> {
        const results = await db
            .select()
            .from(publishingEnvironments)
            .where(eq(publishingEnvironments.publicKey, publicKey));
        return results[0];
    },

    /** 公開鍵の一意制約違反（同時に同じ鍵を登録）は呼び出し側で扱う。 */
    async create(input: CreatePublishingEnvironmentInput): Promise<PublishingEnvironmentRecord> {
        const results = await db
            .insert(publishingEnvironments)
            .values({ id: randomUUID(), ...input })
            .returning();
        return results[0];
    },

    /** 取り消す（本人のもので未取り消しのときだけ）。取り消しは覆らない。 */
    async revoke(userId: string, id: string, at = new Date()): Promise<PublishingEnvironmentRecord | undefined> {
        const results = await db
            .update(publishingEnvironments)
            .set({ revokedAt: at })
            .where(
                and(
                    eq(publishingEnvironments.id, id),
                    eq(publishingEnvironments.userId, userId),
                    isNull(publishingEnvironments.revokedAt),
                ),
            )
            .returning();
        return results[0];
    },

    async touch(id: string, at = new Date()): Promise<void> {
        await db.update(publishingEnvironments).set({ lastUsedAt: at }).where(eq(publishingEnvironments.id, id));
    },
};
