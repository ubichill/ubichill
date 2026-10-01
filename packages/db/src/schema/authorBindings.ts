import { jsonb, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * 他サーバーの作者アカウント（handle@domain）の、確認した公開環境の鍵一覧と表示名。
 * 通常アクセスはこれを使ってネットワークに出ず、fetched_at からの経過で取り直す（T_fresh / T_max）。
 * 自サーバーのアカウントは publishing_environments を直接見るのでここには入れない。
 */
export const authorBindings = pgTable('author_bindings', {
    account: text('account').primaryKey(),
    /** `{ publicKey, addedAt?, revokedAt? }[]`（取り消した鍵も含む） */
    keys: jsonb('keys').$type<Array<{ publicKey: string; addedAt?: string; revokedAt?: string }>>().notNull(),
    displayName: text('display_name'),
    fetchedAt: timestamp('fetched_at').defaultNow().notNull(),
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
        confirmedAt: timestamp('confirmed_at').defaultNow().notNull(),
    },
    (table) => [primaryKey({ columns: [table.account, table.contentHash] })],
);
