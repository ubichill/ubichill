import { and, asc, eq, gte, inArray, like, lt, sql } from 'drizzle-orm';
import { db } from '../index';
import { accounts, externalAccountProfiles, fediverseOauthClients, sessions, users, verifications } from '../schema';

const FEDIVERSE_PROVIDER_PATTERN = 'fediverse:%';

export interface ExternalIdentity {
    /** accounts.providerId（`fediverse:<origin>`） */
    providerId: string;
    /** 認証サーバー内のユーザー ID */
    accountId: string;
    software: string;
    username: string;
}

export interface NewFediverseUser {
    userId: string;
    accountRowId: string;
    /** 予約ドメインの内部値（shared の placeholderEmail） */
    email: string;
    name: string;
    handle: string;
    displayNameKey: string;
    identity: ExternalIdentity;
    now: Date;
    /** そのサーバー（providerId）から `since` 以後に結び付いた外部アカウントが `max` 件以上なら作らない */
    signUpLimit: { since: Date; max: number };
}

export type CreateFediverseUserOutcome =
    | { status: 'created' }
    | { status: 'too-many-sign-ups' }
    | { status: 'identity-taken'; userId: string; accountRowId: string }
    | { status: 'handle-taken' }
    | { status: 'name-taken' };

export type LinkOutcome = { status: 'linked' } | { status: 'already-linked' } | { status: 'linked-to-other' };

export type UnlinkOutcome = { status: 'unlinked' } | { status: 'not-found' } | { status: 'last-method' };

export interface LinkedFediverseAccount {
    id: string;
    providerId: string;
    software: string | null;
    username: string | null;
    createdAt: Date;
}

interface PgError {
    code?: string;
    constraint_name?: string;
    cause?: PgError;
}

/** 一意制約の違反なら制約名を返す。 */
function uniqueViolationOf(error: unknown): string | null {
    const e = error as PgError | undefined;
    const code = e?.code ?? e?.cause?.code;
    return code === '23505' ? (e?.constraint_name ?? e?.cause?.constraint_name ?? '') : null;
}

const profileValues = (accountRowId: string, identity: ExternalIdentity, now: Date) => ({
    accountId: accountRowId,
    software: identity.software,
    username: identity.username,
    updatedAt: now,
});

/** フェディバースのアカウントでのログイン（外部アカウントと Ubichill のユーザーの結び付け・認証の途中の状態）。 */
export const fediverseAccountRepository = {
    /** 外部アカウントに結び付いたユーザーと accounts の行。見つかれば表示用の情報も更新する（改名に追従）。 */
    async findUserByIdentity(
        identity: ExternalIdentity,
        now: Date,
    ): Promise<{ userId: string; accountRowId: string } | undefined> {
        const [row] = await db
            .select({ id: accounts.id, userId: accounts.userId })
            .from(accounts)
            .where(and(eq(accounts.providerId, identity.providerId), eq(accounts.accountId, identity.accountId)));
        if (!row) return undefined;
        await db
            .insert(externalAccountProfiles)
            .values(profileValues(row.id, identity, now))
            .onConflictDoUpdate({
                target: externalAccountProfiles.accountId,
                set: { software: identity.software, username: identity.username, updatedAt: now },
            });
        return { userId: row.userId, accountRowId: row.id };
    },

    /**
     * メールなしのユーザーと外部アカウントを同じトランザクションで作る。同じ外部アカウントで同時に登録されたら、
     * 先に作られたユーザーを返す（同じ人が二重に押したのと同じ扱い）。
     * サーバーごとの登録の上限は、サーバーごとに直列にしてから数えて作る（数えてから作るだけだと、同時の登録が
     * 同じ残りの枠を見て上限を超える）。
     */
    async createUser(input: NewFediverseUser): Promise<CreateFediverseUserOutcome> {
        try {
            return await db.transaction(async (tx) => {
                const { providerId } = input.identity;
                await tx.execute(
                    sql`select pg_advisory_xact_lock(hashtextextended(${`fediverse_sign_ups:${providerId}`}, 0))`,
                );
                const [recent] = await tx
                    .select({ n: sql<number>`count(*)::int` })
                    .from(accounts)
                    .where(and(eq(accounts.providerId, providerId), gte(accounts.createdAt, input.signUpLimit.since)));
                if ((recent?.n ?? 0) >= input.signUpLimit.max) return { status: 'too-many-sign-ups' as const };
                await tx.insert(users).values({
                    id: input.userId,
                    email: input.email,
                    emailVerified: false,
                    name: input.name,
                    image: null,
                    handle: input.handle,
                    displayNameKey: input.displayNameKey,
                    createdAt: input.now,
                    updatedAt: input.now,
                });
                await tx.insert(accounts).values({
                    id: input.accountRowId,
                    providerId: input.identity.providerId,
                    accountId: input.identity.accountId,
                    userId: input.userId,
                    createdAt: input.now,
                    updatedAt: input.now,
                });
                await tx
                    .insert(externalAccountProfiles)
                    .values(profileValues(input.accountRowId, input.identity, input.now));
                return { status: 'created' as const };
            });
        } catch (error) {
            const constraint = uniqueViolationOf(error);
            if (constraint === null) throw error;
            // 同じ外部アカウントの同時登録は、ID が同じなら handle の違反が先に出るので、どの違反でも先に確かめる
            const owner = await this.findUserByIdentity(input.identity, input.now);
            if (owner) return { status: 'identity-taken', ...owner };
            if (constraint === 'users_handle_unique') return { status: 'handle-taken' };
            if (constraint === 'users_display_name_key_unique') return { status: 'name-taken' };
            throw error;
        }
    },

    /** ログイン中のユーザーに外部アカウントを追加する。別のユーザーに結び付いていれば移さない。 */
    async link(input: {
        userId: string;
        accountRowId: string;
        identity: ExternalIdentity;
        now: Date;
    }): Promise<LinkOutcome> {
        try {
            await db.transaction(async (tx) => {
                await tx.insert(accounts).values({
                    id: input.accountRowId,
                    providerId: input.identity.providerId,
                    accountId: input.identity.accountId,
                    userId: input.userId,
                    createdAt: input.now,
                    updatedAt: input.now,
                });
                await tx
                    .insert(externalAccountProfiles)
                    .values(profileValues(input.accountRowId, input.identity, input.now));
            });
            return { status: 'linked' };
        } catch (error) {
            if (uniqueViolationOf(error) !== 'accounts_provider_account_unique') throw error;
            const owner = await this.findUserByIdentity(input.identity, input.now);
            return owner?.userId === input.userId ? { status: 'already-linked' } : { status: 'linked-to-other' };
        }
    },

    /**
     * 外部アカウントの結び付けを外す。外した後も、今の設定で使えるログイン手段（`isUsable`）が残るときだけ。
     * ユーザーの行を押さえて数えるので、同時に複数外しても最後の 1 つは残る。`isUsable` は DB を引かない関数にする
     * （ロック中に別の接続を使わない）。外部アカウントを消すと、そのアカウントで作ったセッションも消える（FK）。
     * ただし外す操作をしている今のセッション（直近に本人確認済み）は残し、外部アカウントとの結び付きだけ外す。
     */
    async unlink(
        userId: string,
        accountRowId: string,
        isUsable: (providerId: string) => boolean,
        currentSessionId: string | null = null,
    ): Promise<UnlinkOutcome> {
        return db.transaction(async (tx) => {
            await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for('update');
            const methods = await tx
                .select({ id: accounts.id, providerId: accounts.providerId })
                .from(accounts)
                .where(eq(accounts.userId, userId));
            const target = methods.find((m) => m.id === accountRowId && m.providerId.startsWith('fediverse:'));
            if (!target) return { status: 'not-found' as const };
            const remaining = methods.filter((m) => m.id !== accountRowId);
            if (!remaining.some((m) => isUsable(m.providerId))) return { status: 'last-method' as const };
            if (currentSessionId) {
                await tx
                    .update(sessions)
                    .set({ authAccountId: null })
                    .where(and(eq(sessions.id, currentSessionId), eq(sessions.authAccountId, accountRowId)));
            }
            await tx.delete(accounts).where(eq(accounts.id, accountRowId));
            return { status: 'unlinked' as const };
        });
    },

    /**
     * 今の設定で使えなくなったサーバー（無効化・許可の外・block）の外部アカウントで作ったセッションを消す。
     * 結び付き自体は残す（設定を戻せば同じアカウントで入れる）。消した数を返す。
     */
    async revokeSessionsOfUnusable(isUsable: (providerId: string) => boolean): Promise<number> {
        const providers = await db
            .selectDistinct({ providerId: accounts.providerId })
            .from(sessions)
            .innerJoin(accounts, eq(accounts.id, sessions.authAccountId));
        const unusable = providers.map((p) => p.providerId).filter((id) => !isUsable(id));
        if (unusable.length === 0) return 0;
        const removed = await db
            .delete(sessions)
            .where(
                inArray(
                    sessions.authAccountId,
                    db.select({ id: accounts.id }).from(accounts).where(inArray(accounts.providerId, unusable)),
                ),
            )
            .returning({ id: sessions.id });
        return removed.length;
    },

    async listLinked(userId: string): Promise<LinkedFediverseAccount[]> {
        return db
            .select({
                id: accounts.id,
                providerId: accounts.providerId,
                software: externalAccountProfiles.software,
                username: externalAccountProfiles.username,
                createdAt: accounts.createdAt,
            })
            .from(accounts)
            .leftJoin(externalAccountProfiles, eq(externalAccountProfiles.accountId, accounts.id))
            .where(and(eq(accounts.userId, userId), like(accounts.providerId, FEDIVERSE_PROVIDER_PATTERN)))
            .orderBy(asc(accounts.createdAt));
    },

    async hasPassword(userId: string): Promise<boolean> {
        const [row] = await db
            .select({ n: sql<number>`count(*)::int` })
            .from(accounts)
            .where(and(eq(accounts.userId, userId), eq(accounts.providerId, 'credential')));
        return (row?.n ?? 0) > 0;
    },

    async findClient(
        origin: string,
        redirectUri: string,
    ): Promise<{ clientId: string; clientSecret: string } | undefined> {
        const [row] = await db
            .select({ clientId: fediverseOauthClients.clientId, clientSecret: fediverseOauthClients.clientSecret })
            .from(fediverseOauthClients)
            .where(and(eq(fediverseOauthClients.origin, origin), eq(fediverseOauthClients.redirectUri, redirectUri)));
        return row;
    },

    /** 登録したアプリを保存する。同時に登録していたら先に保存された方を返す。 */
    async saveClient(input: {
        origin: string;
        redirectUri: string;
        clientId: string;
        clientSecret: string;
    }): Promise<{ clientId: string; clientSecret: string }> {
        await db.insert(fediverseOauthClients).values(input).onConflictDoNothing();
        const saved = await this.findClient(input.origin, input.redirectUri);
        if (!saved) throw new Error('アプリの登録を保存できませんでした');
        return saved;
    },

    /** 登録が無効になった（相手のサーバーで消された）アプリを忘れる。 */
    async forgetClient(origin: string, redirectUri: string): Promise<void> {
        await db
            .delete(fediverseOauthClients)
            .where(and(eq(fediverseOauthClients.origin, origin), eq(fediverseOauthClients.redirectUri, redirectUri)));
    },
};

/**
 * 認証の途中の短命な値（state・登録の途中）。better-auth の verifications を使う（Ubichill は better-auth の
 * メール確認を使っていないので、ほかに書く人はいない）。identifier は種類の前置きとハッシュ。
 */
export const authFlowRepository = {
    async put(identifier: string, value: string, expiresAt: Date, id: string): Promise<void> {
        await db.insert(verifications).values({ id, identifier, value, expiresAt });
    },

    /** 期限内のものを返す（消さない）。 */
    async peek(identifier: string, now: Date): Promise<string | undefined> {
        const [row] = await db
            .select({ value: verifications.value, expiresAt: verifications.expiresAt })
            .from(verifications)
            .where(eq(verifications.identifier, identifier));
        return row && row.expiresAt > now ? row.value : undefined;
    },

    /** 一度だけ取り出す（同時に取り出しても 1 人だけが得る）。期限切れは消して undefined。 */
    async take(identifier: string, now: Date): Promise<string | undefined> {
        const [row] = await db
            .delete(verifications)
            .where(eq(verifications.identifier, identifier))
            .returning({ value: verifications.value, expiresAt: verifications.expiresAt });
        return row && row.expiresAt > now ? row.value : undefined;
    },

    async remove(identifier: string): Promise<void> {
        await db.delete(verifications).where(eq(verifications.identifier, identifier));
    },

    async deleteExpired(prefix: string, now: Date): Promise<void> {
        await db
            .delete(verifications)
            .where(and(like(verifications.identifier, `${prefix}%`), lt(verifications.expiresAt, now)));
    },
};
