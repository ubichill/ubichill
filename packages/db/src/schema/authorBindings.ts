import { jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

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
