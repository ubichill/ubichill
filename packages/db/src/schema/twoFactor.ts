import { bigint, boolean, index, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { accounts, users } from './users';

/**
 * 二段階認証（認証アプリ）。ユーザーごとに 1 つ。enabled_at が null の間は設定の途中（コードを確かめる前）。
 * 秘密鍵はサーバーの秘密から作った鍵で暗号化し、バックアップコードは HMAC だけを持つ（平文は表示した 1 回だけ）。
 */
export const userTwoFactors = pgTable('user_two_factors', {
    userId: text('user_id')
        .primaryKey()
        .references(() => users.id, { onDelete: 'cascade' }),
    /** 認証アプリの秘密鍵（暗号化したもの） */
    secret: text('secret').notNull(),
    enabledAt: timestamp('enabled_at', { withTimezone: true }),
    /** 最後に受け付けたコードの時間の区切り。同じコードを 2 回使わせない */
    lastUsedStep: bigint('last_used_step', { mode: 'number' }),
    backupCodeHashes: text('backup_code_hashes').array().notNull().default([]),
    /** 続けて間違えた回数（ログイン・設定の両方で数える）。成功で 0 に戻す */
    failures: integer('failures').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * ログインの途中（パスワードかフェディバースで本人を確かめ、二段階目のコードを待っている）。
 * ブラウザーには乱数を渡し、ここにはその SHA-256 だけを置く。セッションは二段階目を通ってから作る。
 */
export const twoFactorChallenges = pgTable(
    'two_factor_challenges',
    {
        id: text('id').primaryKey(),
        userId: text('user_id')
            .notNull()
            .references(() => users.id, { onDelete: 'cascade' }),
        /** パスワードで一段階目を通った（セッションの password_verified_at に引き継ぐ） */
        passwordVerified: boolean('password_verified').notNull(),
        /** フェディバースで一段階目を通った外部アカウント（外されたらこのログインも無効） */
        authAccountId: text('auth_account_id').references(() => accounts.id, { onDelete: 'cascade' }),
        /** 「ログインしたままにする」（false ならセッションを 1 日で切る） */
        remember: boolean('remember').notNull(),
        /** 通った後に戻る Ubichill の中のパス */
        returnTo: text('return_to'),
        attempts: integer('attempts').notNull().default(0),
        expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    },
    (table) => [index('two_factor_challenges_expires_at_idx').on(table.expiresAt)],
);
