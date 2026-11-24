import { randomUUID } from 'node:crypto';
import {
    and,
    asc,
    desc,
    eq,
    getTableColumns,
    gt,
    ilike,
    inArray,
    isNotNull,
    isNull,
    lte,
    ne,
    notInArray,
    or,
    type SQL,
    sql,
} from 'drizzle-orm';
import { type Database, db } from '../index';
import { accounts, externalAccountProfiles, sessions, userProfiles, userSettings, users } from '../schema';
import { type InsertCredentialUserOutcome, insertCredentialUser, type NewCredentialUser } from './credentialUser';
import { removeUserRows } from './userRemoval';

export type UserRecord = typeof users.$inferSelect;

/** ログイン中の端末（セッション）。トークンは含めない。 */
export interface AccountSessionRecord {
    id: string;
    createdAt: Date;
    updatedAt: Date;
    ipAddress: string | null;
    userAgent: string | null;
    passwordVerifiedAt: Date | null;
    /** SSO で入ったときの外部アカウント（accounts.providerId・表示用のユーザー名） */
    authProviderId: string | null;
    authUsername: string | null;
}

/** プロフィールの項目（user_profiles）を足したユーザー。行が無ければ未設定（null・空の配列）。 */
export type UserProfileRecord = UserRecord & {
    status: string | null;
    bannerImage: string | null;
    links: string[];
    languages: string[];
};

export interface ProfileFieldsInput {
    status: string | null;
    bio: string | null;
    links: string[];
    languages: string[];
}

type Executor = Database | Parameters<Parameters<Database['transaction']>[0]>[0];

async function selectProfile(executor: Executor, where: SQL): Promise<UserProfileRecord | undefined> {
    const rows = await executor
        .select({
            ...getTableColumns(users),
            status: userProfiles.status,
            bannerImage: userProfiles.bannerImage,
            links: userProfiles.links,
            languages: userProfiles.languages,
        })
        .from(users)
        .leftJoin(userProfiles, eq(userProfiles.userId, users.id))
        .where(where);
    const row = rows[0];
    return row && { ...row, links: row.links ?? [], languages: row.languages ?? [] };
}

export interface CreateUserInput {
    id: string;
    name: string;
    email: string;
    handle: string;
    emailVerified?: boolean;
    image?: string;
}

/** システムユーザーの handle。予約語なので一般の登録と重ならない。 */
const SYSTEM_USER_HANDLE = 'system';

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

    /** ひとことを書いている人だけ、ID → ひとこと。 */
    async statusesOf(ids: readonly string[]): Promise<Map<string, string>> {
        if (ids.length === 0) return new Map();
        const rows = await db
            .select({ userId: userProfiles.userId, status: userProfiles.status })
            .from(userProfiles)
            .where(and(inArray(userProfiles.userId, [...ids]), isNotNull(userProfiles.status)));
        return new Map(rows.flatMap((r) => (r.status ? [[r.userId, r.status] as const] : [])));
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
                handle: input.handle,
                emailVerified: input.emailVerified ?? false,
                image: input.image,
            })
            .returning();
        return results[0];
    },

    /** パスワードでログインできるユーザーを作る（users と accounts を 1 トランザクションで）。退会した ID なら作らない。 */
    async createCredentialUser(user: NewCredentialUser): Promise<InsertCredentialUserOutcome> {
        return db.transaction((tx) => insertCredentialUser(tx, user));
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

    /** プロフィール（user_profiles の項目込み）。 */
    findProfileById(id: string): Promise<UserProfileRecord | undefined> {
        return selectProfile(db, eq(users.id, id));
    },

    findProfileByHandle(handle: string): Promise<UserProfileRecord | undefined> {
        return selectProfile(db, eq(users.handle, handle));
    },

    /**
     * プロフィールの項目（ひとこと・自己紹介・リンク・言語）を置き換える。値は shared の ProfileUpdateSchema を通したもの。
     * ユーザーがいなければ何もせず undefined。
     */
    async setProfile(id: string, profile: ProfileFieldsInput): Promise<UserProfileRecord | undefined> {
        return db.transaction(async (tx) => {
            const now = new Date();
            const updated = await tx
                .update(users)
                .set({ bio: profile.bio, updatedAt: now })
                .where(eq(users.id, id))
                .returning({ id: users.id });
            if (updated.length === 0) return undefined;
            const fields = {
                status: profile.status,
                links: profile.links,
                languages: profile.languages,
                updatedAt: now,
            };
            await tx
                .insert(userProfiles)
                .values({ userId: id, ...fields })
                .onConflictDoUpdate({ target: userProfiles.userId, set: fields });
            return selectProfile(tx, eq(users.id, id));
        });
    },

    /** アイコン（users.image）・バナー（user_profiles.banner_image）の URL を変える。null で外す。 */
    async setProfileImageUrl(
        id: string,
        kind: 'avatar' | 'banner',
        url: string | null,
    ): Promise<UserProfileRecord | undefined> {
        return db.transaction(async (tx) => {
            const now = new Date();
            const updated = await tx
                .update(users)
                .set({ ...(kind === 'avatar' ? { image: url } : {}), updatedAt: now })
                .where(eq(users.id, id))
                .returning({ id: users.id });
            if (updated.length === 0) return undefined;
            if (kind === 'banner') {
                await tx
                    .insert(userProfiles)
                    .values({ userId: id, bannerImage: url, updatedAt: now })
                    .onConflictDoUpdate({ target: userProfiles.userId, set: { bannerImage: url, updatedAt: now } });
            }
            return selectProfile(tx, eq(users.id, id));
        });
    },

    async setPasswordChangeRequired(id: string, required: boolean): Promise<void> {
        await db.update(users).set({ passwordChangeRequired: required, updatedAt: new Date() }).where(eq(users.id, id));
    },

    /** 公式アカウントの初期化用: ID・表示名・確認済みなどをまとめて設定する（ID を書き換えてよいのは昇格のときだけ）。 */
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
    /**
     * ログイン中の端末（期限内のセッション）。新しく使った順。SSO で入ったものは外部アカウントの表示用の情報も付ける。
     * トークンは返さない。
     */
    async listSessions(userId: string, now: Date): Promise<AccountSessionRecord[]> {
        return db
            .select({
                id: sessions.id,
                createdAt: sessions.createdAt,
                updatedAt: sessions.updatedAt,
                ipAddress: sessions.ipAddress,
                userAgent: sessions.userAgent,
                passwordVerifiedAt: sessions.passwordVerifiedAt,
                authProviderId: accounts.providerId,
                authUsername: externalAccountProfiles.username,
            })
            .from(sessions)
            .leftJoin(accounts, eq(accounts.id, sessions.authAccountId))
            .leftJoin(externalAccountProfiles, eq(externalAccountProfiles.accountId, sessions.authAccountId))
            .where(and(eq(sessions.userId, userId), gt(sessions.expiresAt, now)))
            .orderBy(desc(sessions.updatedAt));
    },

    /** その人のセッションを 1 つ消す（ほかの端末をログアウトする）。無ければ false。 */
    async deleteSession(userId: string, sessionId: string): Promise<boolean> {
        const removed = await db
            .delete(sessions)
            .where(and(eq(sessions.userId, userId), eq(sessions.id, sessionId)))
            .returning({ id: sessions.id });
        return removed.length > 0;
    },

    async revokeOtherSessions(userId: string, keepSessionId: string): Promise<number> {
        const removed = await db
            .delete(sessions)
            .where(and(eq(sessions.userId, userId), ne(sessions.id, keepSessionId)))
            .returning({ id: sessions.id });
        return removed.length;
    },

    /** このセッションでパスワードを確かめたことを記録する（再認証）。そのユーザーのセッションでなければ何もしない。 */
    async markSessionPasswordVerified(userId: string, sessionId: string, at: Date): Promise<boolean> {
        const updated = await db
            .update(sessions)
            .set({ passwordVerifiedAt: at })
            .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)))
            .returning({ id: sessions.id });
        return updated.length > 0;
    },

    /** そのユーザーのログインをすべて無効にする。 */
    async revokeSessions(userId: string): Promise<void> {
        await db.delete(sessions).where(eq(sessions.userId, userId));
    },

    /**
     * ID（前方一致）・表示名（部分一致）でユーザーを探す。大文字小文字は区別しない。
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
            .where(
                and(
                    or(handleMatch, nameMatch),
                    options.excludeIds?.length ? notInArray(users.id, [...options.excludeIds]) : undefined,
                ),
            )
            .orderBy(rank, asc(users.name))
            .limit(options.limit);
    },

    /** 新しく登録した順（コントロールパネルで検索語が無いときの一覧）。 */
    async listRecent(options: { limit: number; excludeIds?: readonly string[] }): Promise<UserRecord[]> {
        return db
            .select()
            .from(users)
            .where(and(...(options.excludeIds ?? []).map((id) => ne(users.id, id))))
            .orderBy(desc(users.createdAt), asc(users.id))
            .limit(options.limit);
    },

    /**
     * 検索に出してよい人のページ（sitemap）。「おすすめや検索に出す」をオフにした人とシステムのアカウントは除く
     * （設定の行が無い人は既定のオン）。プロフィールを最近変えた順に limit 人まで。
     */
    async listDiscoverable(limit: number): Promise<Array<{ handle: string; updatedAt: Date }>> {
        return db
            .select({ handle: users.handle, updatedAt: users.updatedAt })
            .from(users)
            .leftJoin(userSettings, eq(userSettings.userId, users.id))
            .where(
                and(
                    ne(users.handle, SYSTEM_USER_HANDLE),
                    or(isNull(userSettings.fediverseDiscoverable), eq(userSettings.fediverseDiscoverable, true)),
                ),
            )
            .orderBy(desc(users.updatedAt), asc(users.handle))
            .limit(limit);
    },

    /** 登録している人の数（システムのアカウントを除く） */
    async countPeople(): Promise<number> {
        const [row] = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(users)
            .where(ne(users.handle, SYSTEM_USER_HANDLE));
        return row?.count ?? 0;
    },

    async findByHandle(handle: string): Promise<UserRecord | undefined> {
        const results = await db.select().from(users).where(eq(users.handle, handle));
        return results[0];
    },

    /** ユーザーを削除する（手順は {@link removeUserRows}）。 */
    async deleteById(id: string): Promise<void> {
        await db.transaction((tx) => removeUserRows(tx, id));
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
            handle: SYSTEM_USER_HANDLE,
            emailVerified: true,
        });
    },
};
