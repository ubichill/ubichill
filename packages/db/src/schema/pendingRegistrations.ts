import { index, integer, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core';

/**
 * メール確認待ちの仮登録。登録 ID・認証コード・パスワードの平文は保存しない。
 * email は小文字で揃えて保存する（better-auth が users.email を小文字で保存し、ログインでも小文字で引くため）。
 * handle と表示名は押さえない（他人の名前を期限まで取り置けないように）。本登録で一意制約に当たれば失敗する。
 */
export const pendingRegistrations = pgTable(
    'pending_registrations',
    {
        /** 申込者に返す registrationId の SHA-256 */
        idHash: text('id_hash').primaryKey(),
        email: text('email').notNull(),
        handle: varchar('handle', { length: 30 }).notNull(),
        displayName: text('display_name').notNull(),
        /** better-auth の hasher で作ったハッシュ（accounts.password と同じ形） */
        passwordHash: text('password_hash').notNull(),
        /** 認証コードの HMAC（鍵はサーバーの秘密）。6 桁は総当たりできるので、鍵なしのハッシュにしない */
        otpHash: text('otp_hash').notNull(),
        failures: integer('failures').notNull().default(0),
        expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    },
    (table) => [
        index('pending_registrations_email_idx').on(table.email),
        index('pending_registrations_expires_at_idx').on(table.expiresAt),
    ],
);
