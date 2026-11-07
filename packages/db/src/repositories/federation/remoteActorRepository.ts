import { and, eq, inArray, ne } from 'drizzle-orm';
import { db } from '../../index';
import { remoteActors } from '../../schema';

export type RemoteActorRecord = typeof remoteActors.$inferSelect;
export type RemoteActorInput = Omit<RemoteActorRecord, 'createdAt' | 'deletedAt'>;

/** ほかのサーバーの actor のキャッシュ。 */
export const remoteActorRepository = {
    /**
     * 保存する（取り直したら上書きし、消えた印も外す）。同じアカウントの古い actor（作り直されたもの）は捨てる。
     */
    async upsert(actor: RemoteActorInput): Promise<RemoteActorRecord> {
        return db.transaction(async (tx) => {
            await tx
                .delete(remoteActors)
                .where(and(eq(remoteActors.account, actor.account), ne(remoteActors.id, actor.id)));
            const [row] = await tx
                .insert(remoteActors)
                .values(actor)
                .onConflictDoUpdate({ target: remoteActors.id, set: { ...actor, deletedAt: null } })
                .returning();
            if (!row) throw new Error('actor を保存できません');
            return row;
        });
    },

    async findById(id: string): Promise<RemoteActorRecord | undefined> {
        const [row] = await db.select().from(remoteActors).where(eq(remoteActors.id, id));
        return row;
    },

    async findByAccount(account: string): Promise<RemoteActorRecord | undefined> {
        const [row] = await db.select().from(remoteActors).where(eq(remoteActors.account, account));
        return row;
    },

    async findByIds(ids: readonly string[]): Promise<RemoteActorRecord[]> {
        if (ids.length === 0) return [];
        return db
            .select()
            .from(remoteActors)
            .where(inArray(remoteActors.id, [...ids]));
    },

    /** 消えた（410・Delete）。関係は消さずに印だけ付ける（関係は呼び手が片付ける）。 */
    async markDeleted(id: string, at: Date): Promise<void> {
        await db.update(remoteActors).set({ deletedAt: at }).where(eq(remoteActors.id, id));
    },
};
