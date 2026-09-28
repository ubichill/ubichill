import { randomUUID } from 'node:crypto';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '../index';
import { accounts, sessions, users } from '../schema';

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

    async findByIds(ids: readonly string[]): Promise<UserRecord[]> {
        if (ids.length === 0) return [];
        return db
            .select()
            .from(users)
            .where(inArray(users.id, [...ids]));
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

    async findByDisplayNameKey(key: string): Promise<UserRecord | undefined> {
        const results = await db.select().from(users).where(eq(users.displayNameKey, key));
        return results[0];
    },

    /** 表示名を変更する（一意キーも更新）。一意制約違反（同時に他人が取った）は呼び出し側で扱う。 */
    async setDisplayName(id: string, name: string, key: string): Promise<UserRecord | undefined> {
        const results = await db
            .update(users)
            .set({ name, displayNameKey: key, updatedAt: new Date() })
            .where(eq(users.id, id))
            .returning();
        return results[0];
    },

    async setPasswordChangeRequired(id: string, required: boolean): Promise<void> {
        await db.update(users).set({ passwordChangeRequired: required, updatedAt: new Date() }).where(eq(users.id, id));
    },

    /** 公式アカウントの初期化用: ID・表示名・確認済み・署名鍵などをまとめて設定する。 */
    async initializeAccount(
        id: string,
        fields: Partial<
            Pick<UserRecord, 'handle' | 'name' | 'displayNameKey' | 'signingPublicKey' | 'emailVerified'>
        > & {
            passwordChangeRequired?: boolean;
        },
    ): Promise<void> {
        await db
            .update(users)
            .set({
                ...fields,
                ...(fields.signingPublicKey ? { signingKeyUpdatedAt: new Date() } : {}),
                updatedAt: new Date(),
            })
            .where(eq(users.id, id));
    },

    /** メール・パスワード方式のパスワードハッシュ（better-auth の credential アカウント）。 */
    async findPasswordHash(userId: string): Promise<string | undefined> {
        const rows = await db
            .select({ password: accounts.password })
            .from(accounts)
            .where(and(eq(accounts.userId, userId), eq(accounts.providerId, 'credential')));
        return rows[0]?.password ?? undefined;
    },

    /** パスワードハッシュを設定する（credential アカウントが無ければ作る）。 */
    async setPasswordHash(userId: string, hash: string): Promise<void> {
        const now = new Date();
        const updated = await db
            .update(accounts)
            .set({ password: hash, updatedAt: now })
            .where(and(eq(accounts.userId, userId), eq(accounts.providerId, 'credential')))
            .returning({ id: accounts.id });
        if (updated.length > 0) return;
        await db.insert(accounts).values({
            id: randomUUID(),
            accountId: userId,
            providerId: 'credential',
            userId,
            password: hash,
            createdAt: now,
            updatedAt: now,
        });
    },

    /** そのユーザーのログインをすべて無効にする。 */
    async revokeSessions(userId: string): Promise<void> {
        await db.delete(sessions).where(eq(sessions.userId, userId));
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
