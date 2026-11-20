import { pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';
import { accounts } from './users';

/**
 * Mastodon に登録した Ubichill のアプリ（`POST /api/v1/apps`）。認証サーバーと戻り先 URL ごとに 1 つ作って使い回す。
 * Misskey は client_id が Ubichill の URL なので登録しない。
 */
export const fediverseOauthClients = pgTable(
    'fediverse_oauth_clients',
    {
        /** 認証サーバーの origin（`https://host`） */
        origin: text('origin').notNull(),
        redirectUri: text('redirect_uri').notNull(),
        clientId: text('client_id').notNull(),
        clientSecret: text('client_secret').notNull(),
        createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    },
    (table) => [primaryKey({ columns: [table.origin, table.redirectUri] })],
);

/**
 * フェディバースの外部アカウントの表示用の情報（accounts と 1 対 1）。識別には使わない（改名で変わる）。
 * accounts は better-auth の表なので広げず、ここに置く。ログインのたびに更新する。
 */
export const externalAccountProfiles = pgTable('external_account_profiles', {
    accountId: text('account_id')
        .primaryKey()
        .references(() => accounts.id, { onDelete: 'cascade' }),
    /** 'mastodon' | 'misskey'（shared の FEDIVERSE_SOFTWARE） */
    software: text('software').notNull(),
    username: text('username').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
