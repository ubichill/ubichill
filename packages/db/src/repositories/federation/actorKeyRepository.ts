import { and, eq } from 'drizzle-orm';
import { db } from '../../index';
import { federationActorKeys } from '../../schema';

export type ActorKeyRecord = typeof federationActorKeys.$inferSelect;
export type NewActorKey = Omit<ActorKeyRecord, 'createdAt'>;

/** このサーバーの actor の RSA の鍵。作るのも暗号化も backend の federation/rsaKeys.ts。 */
export const actorKeyRepository = {
    async get(actorId: string): Promise<ActorKeyRecord | undefined> {
        const [row] = await db.select().from(federationActorKeys).where(eq(federationActorKeys.actorId, actorId));
        return row;
    },

    /** 無ければ入れる。同時に作られたら先に入ったほうを返す（同じ actor に鍵を 2 つ作らない）。 */
    async insertIfAbsent(key: NewActorKey, now: Date): Promise<ActorKeyRecord> {
        await db
            .insert(federationActorKeys)
            .values({ ...key, createdAt: now })
            .onConflictDoNothing({ target: federationActorKeys.actorId });
        const stored = await this.get(key.actorId);
        if (!stored) throw new Error('鍵を保存できません');
        return stored;
    },

    /** 秘密鍵を暗号化し直す（種を差し替えたあと）。 */
    async rewrap(actorId: string, privateKeyEncrypted: string): Promise<void> {
        await db
            .update(federationActorKeys)
            .set({ privateKeyEncrypted })
            .where(eq(federationActorKeys.actorId, actorId));
    },

    /**
     * 読めなくなった鍵を作り直す（種を 2 世代以上差し替えた）。ほかの backend が先に作り直していたらそれを返す
     * （読めなかった行のままのときだけ書き換える）。
     */
    async replace(key: NewActorKey, unreadable: string, now: Date): Promise<ActorKeyRecord> {
        await db
            .update(federationActorKeys)
            .set({ publicKeyPem: key.publicKeyPem, privateKeyEncrypted: key.privateKeyEncrypted, createdAt: now })
            .where(
                and(
                    eq(federationActorKeys.actorId, key.actorId),
                    eq(federationActorKeys.privateKeyEncrypted, unreadable),
                ),
            );
        const stored = await this.get(key.actorId);
        if (!stored) throw new Error('鍵を保存できません');
        return stored;
    },
};
