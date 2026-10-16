import { randomUUID } from 'node:crypto';
import { and, asc, eq, ilike, inArray, isNull, lte, ne, or, type SQL, sql } from 'drizzle-orm';
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
    /**
     * 表示名を変える。`changedAt` を渡すと変更の時刻を記録する（一意キーを変えるとき）。
     * `notChangedAfter` を渡すと、最後の変更がそれより後のときは書き込まない（期間中の同時リクエストで
     * 2 回変えられないよう、判定と書き込みを 1 つの UPDATE にする）。書き込まなければ undefined。
     */
    async setDisplayName(
        id: string,
        name: string,
        key: string,
        options: { changedAt?: Date; notChangedAfter?: Date } = {},
    ): Promise<UserRecord | undefined> {
        const cooldown = options.notChangedAfter
            ? or(isNull(users.displayNameChangedAt), lte(users.displayNameChangedAt, options.notChangedAfter))
            : undefined;
        const results = await db
            .update(users)
            .set({
                name,
                displayNameKey: key,
                updatedAt: new Date(),
                ...(options.changedAt ? { displayNameChangedAt: options.changedAt } : {}),
            })
            .where(and(eq(users.id, id), cooldown))
            .returning();
        return results[0];
    },

    async setBio(id: string, bio: string | null): Promise<UserRecord | undefined> {
        const results = await db.update(users).set({ bio, updatedAt: new Date() }).where(eq(users.id, id)).returning();
        return results[0];
    },

    async setPasswordChangeRequired(id: string, required: boolean): Promise<void> {
        await db.update(users).set({ passwordChangeRequired: required, updatedAt: new Date() }).where(eq(users.id, id));
    },

    /** 公式アカウントの初期化用: ID・表示名・確認済みなどをまとめて設定する。 */
    async initializeAccount(
        id: string,
        fields: Partial<Pick<UserRecord, 'handle' | 'name' | 'displayNameKey' | 'emailVerified'>> & {
            passwordChangeRequired?: boolean;
        },
    ): Promise<void> {
        await db
            .update(users)
            .set({ ...fields, updatedAt: new Date() })
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

    /** いま使っているもの以外のログインをすべて無効にする（乗っ取りに気付いたとき）。無効にした数を返す。 */
    async revokeOtherSessions(userId: string, keepSessionId: string): Promise<number> {
        const removed = await db
            .delete(sessions)
            .where(and(eq(sessions.userId, userId), ne(sessions.id, keepSessionId)))
            .returning({ id: sessions.id });
        return removed.length;
    },

    /** そのユーザーのログインをすべて無効にする。 */
    async revokeSessions(userId: string): Promise<void> {
        await db.delete(sessions).where(eq(sessions.userId, userId));
    },

    /**
     * ID（前方一致）・表示名（部分一致）でユーザーを探す。大文字小文字は区別しない。ID の無いユーザーも表示名で見つかる。
     * `excludeIds` はシステムユーザーなど検索に出さないもの。
     */
    /**
     * ユーザー検索。ID の前方一致と、表示名の一意キーの部分一致（全角半角・大文字小文字を区別しない）。
     * 並びは ID の完全一致 → ID の前方一致 → 表示名の完全一致 → それ以外（同じ順位は表示名順）。
     * 一意キーの無いユーザー（移行時に重複していた）は表示名そのもので照合する。
     */
    async search(
        query: { handlePrefix: string | null; nameKey: string },
        options: { limit: number; excludeIds?: readonly string[] },
    ): Promise<UserRecord[]> {
        const escapeLike = (v: string) => v.replace(/[\\%_]/g, (c) => `\\${c}`);
        const nameMatch = or(
            ilike(users.displayNameKey, `%${escapeLike(query.nameKey)}%`),
            and(isNull(users.displayNameKey), ilike(users.name, `%${escapeLike(query.nameKey)}%`)),
        );
        const handleMatch = query.handlePrefix ? ilike(users.handle, `${escapeLike(query.handlePrefix)}%`) : undefined;
        const rank: SQL = query.handlePrefix
            ? sql`case when ${users.handle} = ${query.handlePrefix} then 0
                       when ${users.handle} like ${`${escapeLike(query.handlePrefix)}%`} then 1
                       when ${users.displayNameKey} = ${query.nameKey} then 2
                       else 3 end`
            : sql`case when ${users.displayNameKey} = ${query.nameKey} then 2 else 3 end`;
        return db
            .select()
            .from(users)
            .where(and(or(handleMatch, nameMatch), ...(options.excludeIds ?? []).map((id) => ne(users.id, id))))
            .orderBy(rank, asc(users.name))
            .limit(options.limit);
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
