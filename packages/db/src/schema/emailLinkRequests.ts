import { index, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { users } from './users';

/**
 * メールアドレスの追加（メールなしで登録したユーザーが、ログイン方法と連絡先にメールを足す）の確認待ち。
 * ユーザーごとに 1 つ（申し込み直すと置き換える）。認証コードとパスワードの平文は保存しない。
 * email は小文字で揃える（better-auth が users.email を小文字で保存し、ログインでも小文字で引くため）。
 */
export const emailLinkRequests = pgTable(
    'email_link_requests',
    {
        userId: text('user_id')
            .primaryKey()
            .references(() => users.id, { onDelete: 'cascade' }),
        email: text('email').notNull(),
        /** better-auth の hasher で作ったハッシュ（accounts.password と同じ形） */
        passwordHash: text('password_hash').notNull(),
        /** 認証コードの HMAC（鍵はサーバーの秘密） */
        otpHash: text('otp_hash').notNull(),
        failures: integer('failures').notNull().default(0),
        expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    },
    (table) => [index('email_link_requests_expires_at_idx').on(table.expiresAt)],
);
