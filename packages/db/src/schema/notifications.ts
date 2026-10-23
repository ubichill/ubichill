import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { users } from './users';

/**
 * 本人に関わる出来事の通知（ActivityStreams 2.0 の Follow・Accept・Like）。object の形は種類ごとに shared のスキーマで確かめる。
 * actor はこのサーバーのユーザー（actor_user_id、消えたら通知も消える）か、将来のリモートの actor の URI（actor_uri）のどちらか 1 つ。
 */
export const notifications = pgTable(
    'notifications',
    {
        id: text('id').primaryKey(),
        recipientId: text('recipient_id')
            .notNull()
            .references(() => users.id, { onDelete: 'cascade' }),
        type: text('type').notNull(),
        actorUserId: text('actor_user_id').references(() => users.id, { onDelete: 'cascade' }),
        actorUri: text('actor_uri'),
        object: jsonb('object').notNull(),
        /** 同じ出来事を 2 回作らないためのキー（受け手ごとに一意。例: `Like:<actor>:<world>`） */
        dedupeKey: text('dedupe_key').notNull(),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        readAt: timestamp('read_at', { withTimezone: true }),
    },
    (table) => [
        check('notifications_type_check', sql`${table.type} IN ('Follow', 'Accept', 'Like')`),
        check('notifications_actor_check', sql`num_nonnulls(${table.actorUserId}, ${table.actorUri}) = 1`),
        uniqueIndex('notifications_recipient_dedupe_idx').on(table.recipientId, table.dedupeKey),
        index('notifications_recipient_created_idx').on(table.recipientId, table.createdAt.desc(), table.id.desc()),
        index('notifications_unread_idx').on(table.recipientId).where(sql`${table.readAt} IS NULL`),
        index('notifications_actor_user_idx').on(table.actorUserId),
        index('notifications_created_at_idx').on(table.createdAt),
    ],
);

/** 運営からのお知らせ。全員に行を書かず、読むときに利用者ごとの既読の位置と合わせる。 */
export const announcements = pgTable(
    'announcements',
    {
        id: text('id').primaryKey(),
        authorId: text('author_id').references(() => users.id, { onDelete: 'set null' }),
        title: text('title').notNull(),
        content: text('content').notNull(),
        publishedAt: timestamp('published_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [index('announcements_published_idx').on(table.publishedAt.desc(), table.id.desc())],
);

/** お知らせをどこまで読んだか（この時刻以前に出したお知らせは既読）。行が無ければ登録した時刻。 */
export const announcementReads = pgTable('announcement_reads', {
    userId: text('user_id')
        .primaryKey()
        .references(() => users.id, { onDelete: 'cascade' }),
    readUntil: timestamp('read_until', { withTimezone: true }).notNull(),
});
