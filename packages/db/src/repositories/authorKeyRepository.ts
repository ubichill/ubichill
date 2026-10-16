import { randomUUID } from 'node:crypto';
import { normalizeEd25519PublicKey, SIGNING_KEY_ALGORITHM } from '@ubichill/shared';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { type Database, db } from '../index';
import { authorConfirmedContents, authorKeys, remoteAuthors } from '../schema';
import { type FetchedSigningKey, type LocalAuthorKeyRecord, localKeyOf, remoteKeyRowsOf } from './authorKeyRows';

export interface CreateLocalAuthorKeyInput {
    userId: string;
    kind: string;
    name: string;
    publicKey: string;
    apiTokenHash?: string;
}

export interface RemoteAuthorKeyRecord {
    publicKey: string;
    createdAt: Date;
    revokedAt: Date | null;
    /** 同じ鍵が自サーバーの公開環境にある（なりすましの試み。署名の確認では使わない）。 */
    claimsLocalKey: boolean;
}

export interface RemoteAuthorRecord {
    account: string;
    displayName: string | null;
    fetchedAt: Date;
    keys: RemoteAuthorKeyRecord[];
}

const isLocal = eq(authorKeys.origin, 'local');
const localKeys = alias(authorKeys, 'local_keys');

/** 公開鍵を正規化する。読めない鍵は保存しない（呼び出し側で形を確かめてから渡す）。 */
function requireNormalized(publicKey: string): string {
    const normalized = normalizeEd25519PublicKey(publicKey);
    if (!normalized) throw new Error('公開鍵の形が不正です');
    return normalized;
}

/**
 * 作者の鍵（author_keys・remote_authors）と、確認済みの内容（author_confirmed_contents）の読み書き。
 * 公開鍵は保存・照合の前に正規化する（同じ鍵の別の書き方を同じ鍵として扱う）。
 * DB は関数で受け取る（index.ts と互いに import するので、読み込みの時点では db がまだ無い）。
 */
export function createAuthorKeyRepository(database: () => Database) {
    return {
        /** 本人の公開環境（取り消したものも含む。鍵一覧の公開・管理画面用）。 */
        async listByUser(userId: string): Promise<LocalAuthorKeyRecord[]> {
            const rows = await database()
                .select()
                .from(authorKeys)
                .where(and(isLocal, eq(authorKeys.userId, userId)))
                .orderBy(asc(authorKeys.createdAt), asc(authorKeys.id));
            return rows.map(localKeyOf);
        },

        /** 自サーバーの公開環境の鍵を引く（どのアカウントのものでも。取り消したものも含む）。 */
        async findLocalKey(publicKey: string): Promise<LocalAuthorKeyRecord | undefined> {
            const normalized = normalizeEd25519PublicKey(publicKey);
            if (!normalized) return undefined;
            const rows = await database()
                .select()
                .from(authorKeys)
                .where(
                    and(isLocal, eq(authorKeys.algorithm, SIGNING_KEY_ALGORITHM), eq(authorKeys.publicKey, normalized)),
                );
            return rows[0] ? localKeyOf(rows[0]) : undefined;
        },

        /**
         * 公開環境を作る。同じ鍵が自サーバーのどこかに既にあれば（取り消し済みでも、別のアカウントでも）一意制約で失敗する。
         * 一意制約違反（同時に同じ鍵を登録）は呼び出し側で扱う。
         */
        async createLocal(input: CreateLocalAuthorKeyInput): Promise<LocalAuthorKeyRecord> {
            const rows = await database()
                .insert(authorKeys)
                .values({
                    id: randomUUID(),
                    origin: 'local',
                    algorithm: SIGNING_KEY_ALGORITHM,
                    userId: input.userId,
                    kind: input.kind,
                    name: input.name,
                    publicKey: requireNormalized(input.publicKey),
                    apiTokenHash: input.apiTokenHash,
                })
                .returning();
            return localKeyOf(rows[0]);
        },

        /** 取り消す（本人のもので未取り消しのときだけ）。取り消しは覆らない。 */
        async revoke(
            userId: string,
            id: string,
            reason: 'lost' | 'compromised',
            at = new Date(),
        ): Promise<LocalAuthorKeyRecord | undefined> {
            const rows = await database()
                .update(authorKeys)
                .set({ revokedAt: at, revokeReason: reason })
                .where(and(isLocal, eq(authorKeys.id, id), eq(authorKeys.userId, userId), isNull(authorKeys.revokedAt)))
                .returning();
            return rows[0] ? localKeyOf(rows[0]) : undefined;
        },

        /** 本人の未取り消しの公開環境をすべて取り消し、取り消した数を返す。 */
        async revokeAllForUser(userId: string, reason: 'lost' | 'compromised', at = new Date()): Promise<number> {
            const rows = await database()
                .update(authorKeys)
                .set({ revokedAt: at, revokeReason: reason })
                .where(and(isLocal, eq(authorKeys.userId, userId), isNull(authorKeys.revokedAt)))
                .returning({ id: authorKeys.id });
            return rows.length;
        },

        async touch(id: string, at = new Date()): Promise<void> {
            await database()
                .update(authorKeys)
                .set({ lastUsedAt: at })
                .where(and(isLocal, eq(authorKeys.id, id)));
        },

        /** API トークン（の hash）から、取り消されていない公開環境を引く。 */
        async findActiveByTokenHash(tokenHash: string): Promise<LocalAuthorKeyRecord | undefined> {
            const rows = await database()
                .select()
                .from(authorKeys)
                .where(and(isLocal, eq(authorKeys.apiTokenHash, tokenHash), isNull(authorKeys.revokedAt)));
            return rows[0] ? localKeyOf(rows[0]) : undefined;
        },

        /** 他サーバーの作者の、最後に確認した鍵一覧と表示名。 */
        async findRemoteAuthor(account: string): Promise<RemoteAuthorRecord | undefined> {
            const [author] = await database().select().from(remoteAuthors).where(eq(remoteAuthors.account, account));
            if (!author) return undefined;
            // local の (algorithm, public_key) は部分一意なので、結合しても行は増えない
            const keys = await database()
                .select({
                    publicKey: authorKeys.publicKey,
                    createdAt: authorKeys.createdAt,
                    revokedAt: authorKeys.revokedAt,
                    claimsLocalKey: sql<boolean>`${localKeys.id} IS NOT NULL`,
                })
                .from(authorKeys)
                .leftJoin(
                    localKeys,
                    and(
                        eq(localKeys.origin, 'local'),
                        eq(localKeys.algorithm, authorKeys.algorithm),
                        eq(localKeys.publicKey, authorKeys.publicKey),
                    ),
                )
                .where(and(eq(authorKeys.origin, 'remote'), eq(authorKeys.account, account)))
                .orderBy(asc(authorKeys.createdAt), asc(authorKeys.publicKey));
            return { account, displayName: author.displayName, fetchedAt: author.fetchedAt, keys };
        },

        /**
         * 取り直した鍵一覧と表示名で置き換える（作者のサーバーの一覧をそのまま写す）。
         * 自サーバーの公開環境と同じ鍵を名乗る鍵も保存し、その鍵を返す（呼び出し側で警告を記録する）。
         */
        async saveRemoteAuthor(
            account: string,
            profile: { keys: readonly FetchedSigningKey[]; displayName?: string },
            fetchedAt = new Date(),
        ): Promise<{ claimedLocalKeys: string[] }> {
            const rows = remoteKeyRowsOf(profile.keys, fetchedAt);
            return database().transaction(async (tx) => {
                // 先に remote_authors の行を押さえ、同じアカウントの同時の保存を直列にする
                await tx
                    .insert(remoteAuthors)
                    .values({ account, displayName: profile.displayName, fetchedAt })
                    .onConflictDoUpdate({
                        target: remoteAuthors.account,
                        set: { displayName: profile.displayName ?? null, fetchedAt },
                    });
                await tx
                    .delete(authorKeys)
                    .where(and(eq(authorKeys.origin, 'remote'), eq(authorKeys.account, account)));
                if (rows.length === 0) return { claimedLocalKeys: [] };
                await tx.insert(authorKeys).values(
                    rows.map((row) => ({
                        id: randomUUID(),
                        origin: 'remote',
                        account,
                        algorithm: SIGNING_KEY_ALGORITHM,
                        publicKey: row.publicKey,
                        createdAt: row.createdAt,
                        fetchedAt,
                        revokedAt: row.revokedAt,
                    })),
                );
                const claimed = await tx
                    .select({ publicKey: authorKeys.publicKey })
                    .from(authorKeys)
                    .where(
                        and(
                            isLocal,
                            eq(authorKeys.algorithm, SIGNING_KEY_ALGORITHM),
                            inArray(
                                authorKeys.publicKey,
                                rows.map((row) => row.publicKey),
                            ),
                        ),
                    );
                return { claimedLocalKeys: claimed.map((row) => row.publicKey) };
            });
        },

        /** 作者付きと確かめた内容を記録する（確認が古くなった間に作者を付けてよい内容）。 */
        async recordConfirmedContent(account: string, contentHash: string): Promise<void> {
            await database().insert(authorConfirmedContents).values({ account, contentHash }).onConflictDoNothing();
        },

        async hasConfirmedContent(account: string, contentHash: string): Promise<boolean> {
            const rows = await database()
                .select({ account: authorConfirmedContents.account })
                .from(authorConfirmedContents)
                .where(
                    and(
                        eq(authorConfirmedContents.account, account),
                        eq(authorConfirmedContents.contentHash, contentHash),
                    ),
                )
                .limit(1);
            return rows.length > 0;
        },
    };
}

export type AuthorKeyRepository = ReturnType<typeof createAuthorKeyRepository>;

export const authorKeyRepository: AuthorKeyRepository = createAuthorKeyRepository(() => db);
