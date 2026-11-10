import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { users } from './users';

/**
 * フレンド同士のメッセージ（このサーバーのユーザーどうし）。送れるかは送るときに shared の messageRefusal で確かめる。
 * どちらかのユーザーが消えたら一緒に消える。古いものは通知と同じ日数で掃除する。
 */
export const directMessages = pgTable(
    'direct_messages',
    {
        id: text('id').primaryKey(),
        senderId: text('sender_id')
            .notNull()
            .references(() => users.id, { onDelete: 'cascade' }),
        recipientId: text('recipient_id')
            .notNull()
            .references(() => users.id, { onDelete: 'cascade' }),
        content: text('content').notNull(),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        /** 受け手が読んだ時刻（送った人には見せない） */
        readAt: timestamp('read_at', { withTimezone: true }),
    },
    (table) => [
        check('direct_messages_not_self_check', sql`${table.senderId} <> ${table.recipientId}`),
        // 会話は 2 方向の行を合わせて読むので、向きごとに (送った人, 受け手, 時刻) で引く
        index('direct_messages_pair_created_idx').on(
            table.senderId,
            table.recipientId,
            table.createdAt.desc(),
            table.id.desc(),
        ),
        index('direct_messages_recipient_created_idx').on(table.recipientId, table.createdAt.desc()),
        index('direct_messages_unread_idx').on(table.recipientId, table.senderId).where(sql`${table.readAt} IS NULL`),
        index('direct_messages_created_at_idx').on(table.createdAt),
    ],
);
