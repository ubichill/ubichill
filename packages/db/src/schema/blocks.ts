import { sql } from 'drizzle-orm';
import { check, index, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';
import { users } from './users';

/**
 * ユーザーのブロック（blocker が blocked をブロックした。片方向）。判定の規則は shared の user/blocks.ts。
 * blocked はこのサーバーのユーザー ID か、ほかのサーバーの actor の URL（連合）なので外部キーを付けない。
 */
export const userBlocks = pgTable(
    'user_blocks',
    {
        blockerId: text('blocker_id')
            .notNull()
            .references(() => users.id, { onDelete: 'cascade' }),
        blockedId: text('blocked_id').notNull(),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
        primaryKey({ name: 'user_blocks_pk', columns: [table.blockerId, table.blockedId] }),
        index('user_blocks_blocked_idx').on(table.blockedId),
        check('user_blocks_not_self', sql`${table.blockerId} <> ${table.blockedId}`),
    ],
);
