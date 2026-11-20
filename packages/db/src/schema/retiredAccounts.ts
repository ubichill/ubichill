import { pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core';

/**
 * 退会したアカウント。users の行は消し（持ち物は FK で一緒に消える）、ここに ID（handle）とユーザー ID だけ残す。
 * - handle は二度と使わせない（同じ ID を別人が取ると、作者として署名したワールドの作者になりすませる）
 * - 連合の actor（/ap/users/<ユーザー ID>）と WebFinger は 410 Gone を返し、ほかのサーバーに消えたと分からせる
 */
export const retiredAccounts = pgTable('retired_accounts', {
    userId: text('user_id').primaryKey(),
    handle: varchar('handle', { length: 30 }).notNull().unique(),
    retiredAt: timestamp('retired_at', { withTimezone: true }).defaultNow().notNull(),
});
