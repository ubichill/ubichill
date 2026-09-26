import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../index';
import { users } from '../schema';

export type UserRecord = typeof users.$inferSelect;

export interface CreateUserInput {
    id: string;
    name: string;
    email: string;
    emailVerified?: boolean;
    image?: string;
    username?: string;
    profileImageUrl?: string;
}

export const userRepository = {
    async findById(id: string): Promise<UserRecord | undefined> {
        const results = await db.select().from(users).where(eq(users.id, id));
        return results[0];
    },

    async findByEmail(email: string): Promise<UserRecord | undefined> {
        const results = await db.select().from(users).where(eq(users.email, email));
        return results[0];
    },

    async create(input: CreateUserInput): Promise<UserRecord> {
        const results = await db
            .insert(users)
            .values({
                id: input.id,
                name: input.name,
                email: input.email,
                emailVerified: input.emailVerified ?? false,
                image: input.image,
                username: input.username,
                profileImageUrl: input.profileImageUrl,
            })
            .returning();
        return results[0];
    },

    async findByHandle(handle: string): Promise<UserRecord | undefined> {
        const results = await db.select().from(users).where(eq(users.handle, handle));
        return results[0];
    },

    /**
     * handle を設定する。変更不可なので未設定のときだけ書き込む（同時リクエストでも上書きしない）。
     * 一意制約違反（他人が同時に取った）は呼び出し側で扱う。
     */
    async setHandleOnce(id: string, handle: string): Promise<UserRecord | undefined> {
        const results = await db
            .update(users)
            .set({ handle, updatedAt: new Date() })
            .where(and(eq(users.id, id), isNull(users.handle)))
            .returning();
        return results[0];
    },

    async setSigningPublicKey(id: string, publicKey: string): Promise<UserRecord | undefined> {
        const now = new Date();
        const results = await db
            .update(users)
            .set({ signingPublicKey: publicKey, signingKeyUpdatedAt: now, updatedAt: now })
            .where(eq(users.id, id))
            .returning();
        return results[0];
    },

    /** ユーザーを削除する（ワールド・お気に入り等は FK の cascade で消える）。 */
    async deleteById(id: string): Promise<void> {
        await db.delete(users).where(eq(users.id, id));
    },

    async ensureSystemUser(systemUserId: string): Promise<UserRecord> {
        const existing = await this.findById(systemUserId);
        if (existing) {
            return existing;
        }

        return this.create({
            id: systemUserId,
            name: 'System',
            email: 'system@ubichill.local',
            emailVerified: true,
        });
    },
};
