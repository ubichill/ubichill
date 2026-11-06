import { sql } from 'drizzle-orm';
import { check, index, pgTable, primaryKey, text, timestamp, unique, uniqueIndex } from 'drizzle-orm/pg-core';
import { users } from './users';

/**
 * 作者の署名鍵（自サーバーの公開環境と、他サーバーの作者の鍵一覧を 1 つにしたもの）。
 *
 * - 公開鍵は主キーにしない。信頼の単位は「アカウントと鍵の組」で、他サーバーが自サーバーの利用者の鍵を
 *   名乗ってきても、両方の主張を記録できるようにする（docs/design/db-redesign.md）。
 * - public_key は正規化した値（shared の normalizeEd25519PublicKey）。DB でも CHECK で正規形だけを受け付ける。
 * - local の行は account を持たず、user_id → users.handle と PUBLIC_BASE_URL から作者アカウントを決める。
 *   自ドメインは環境変数で決まり DB からは見えない・変えられる、handle が未設定のユーザーも鍵を持てるため。
 *   local の一意は (algorithm, public_key) の部分一意で守る（1 つの鍵を持てる自サーバーのアカウントは 1 つ）。
 * - 取り消しは削除せず revoked_at を立てる（取り消しは覆らない。同じ鍵を登録し直すこともできない）。
 */
export const authorKeys = pgTable(
    'author_keys',
    {
        id: text('id').primaryKey(),
        /** remote のときだけ（handle@domain）。 */
        account: text('account'),
        algorithm: text('algorithm').notNull(),
        publicKey: text('public_key').notNull(),
        /** local / remote */
        origin: text('origin').notNull(),
        /** local のときだけ。 */
        userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
        /** browser / cli / ci / legacy（local のときだけ） */
        kind: text('kind'),
        name: text('name'),
        apiTokenHash: text('api_token_hash').unique(),
        createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
        lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
        /** remote のときだけ（鍵一覧から最後に確認した時刻）。 */
        fetchedAt: timestamp('fetched_at', { withTimezone: true }),
        revokedAt: timestamp('revoked_at', { withTimezone: true }),
        /**
         * 取り消した理由（local のときだけ）。lost（紛失・データ消去）/ compromised（漏えい・心当たりのない環境）。
         * compromised の鍵で署名したワールドは、攻撃者が書き換えた内容かもしれないので一括の署名し直しの対象にしない。
         */
        revokeReason: text('revoke_reason'),
    },
    (table) => [
        unique('author_keys_account_key_unique').on(table.account, table.algorithm, table.publicKey),
        uniqueIndex('author_keys_local_key_unique')
            .on(table.algorithm, table.publicKey)
            .where(sql`${table.origin} = 'local'`),
        index('author_keys_user_id_idx').on(table.userId),
        check('author_keys_origin_check', sql`${table.origin} IN ('local', 'remote')`),
        check('author_keys_local_user_check', sql`(${table.origin} = 'local') = (${table.userId} IS NOT NULL)`),
        check('author_keys_remote_account_check', sql`(${table.origin} = 'remote') = (${table.account} IS NOT NULL)`),
        check(
            'author_keys_local_fields_check',
            sql`${table.origin} = 'remote' OR (${table.kind} IS NOT NULL AND ${table.name} IS NOT NULL)`,
        ),
        check(
            'author_keys_remote_fields_check',
            sql`${table.origin} = 'local' OR (${table.apiTokenHash} IS NULL AND ${table.revokeReason} IS NULL)`,
        ),
        check(
            'author_keys_revoke_reason_check',
            sql`${table.revokeReason} IS NULL OR ${table.revokeReason} IN ('lost', 'compromised')`,
        ),
        // 43 文字目の下位 2 bit（32 byte に入らない余り）が 0 の base64url だけ。別の書き方の同じ鍵を別の行にしない
        check(
            'author_keys_public_key_check',
            sql`${table.algorithm} = 'ed25519' AND ${table.publicKey} ~ '^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$'`,
        ),
    ],
);

/** 他サーバーの作者アカウントの、最後に確認した表示名と時刻（鍵は author_keys の remote の行）。 */
export const remoteAuthors = pgTable('remote_authors', {
    account: text('account').primaryKey(),
    displayName: text('display_name'),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull(),
});

/**
 * 他サーバーの作者の鍵一覧が新しい（確認が古くない）うちに、作者付きと確かめたワールドの内容（contentHash）。
 * 作者のサーバーを取り直せず確認が古くなった間は、ここにある内容にだけ作者を付ける。盗んだ鍵で新しく出した作品に、
 * 作者のサーバーを止めて作者を付けさせることを防ぐ（既存の作品は一覧から消えない）。
 */
export const authorConfirmedContents = pgTable(
    'author_confirmed_contents',
    {
        account: text('account').notNull(),
        contentHash: text('content_hash').notNull(),
        confirmedAt: timestamp('confirmed_at', { withTimezone: true }).defaultNow().notNull(),
    },
    (table) => [primaryKey({ columns: [table.account, table.contentHash] })],
);
