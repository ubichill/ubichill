import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { users } from './users';

/**
 * CLI・CI の認可要求（`ubichill login` / `ubichill ci create`）。ブラウザで承認され、CLI が鍵の所有を証明して
 * 引き換えたときに公開環境と API トークンを作る。10 分で失効し、1 回しか引き換えられない。
 * - ループバック（RFC 8252）: redirect_uri と code_challenge（S256）を持ち、承認時に認可コードを発行する
 * - デバイス認可（RFC 8628）: user_code（承認画面で確かめる短いコード）と device_code（CLI のポーリング用）を持つ
 * コード類は sha256 だけを保存する（user_code は画面で照合するので平文）。
 */
export const cliAuthRequests = pgTable('cli_auth_requests', {
    id: text('id').primaryKey(),
    /** cli / ci */
    kind: text('kind').notNull(),
    name: text('name').notNull(),
    publicKey: text('public_key').notNull(),
    redirectUri: text('redirect_uri'),
    codeChallenge: text('code_challenge'),
    userCode: text('user_code').unique(),
    deviceCodeHash: text('device_code_hash').unique(),
    authCodeHash: text('auth_code_hash').unique(),
    /** 承認したユーザー（承認されるまで null） */
    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
    /** pending / approved / consumed */
    status: text('status').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    expiresAt: timestamp('expires_at').notNull(),
});
