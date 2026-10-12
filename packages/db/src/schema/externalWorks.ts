import { index, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';
import { users } from './users';

/**
 * 作者が外部（GitHub Pages など）に置いた作品の URL。中身は持たない。`ubichill publish` が署名したときに登録し、
 * 登録は作者本人の署名が付いた内容でしか受け付けない。ユーザーページに出す前に、その URL が本人の署名付きの作品を
 * いま配っているかを確かめる。
 */
export const externalWorks = pgTable(
    'external_works',
    {
        userId: text('user_id')
            .notNull()
            .references(() => users.id, { onDelete: 'cascade' }),
        /** world / mod */
        kind: text('kind').notNull(),
        /** world は .yaml の URL、mod は配布の基点。 */
        url: text('url').notNull(),
        /** world は metadata.name、mod は mod の ID。 */
        name: text('name').notNull(),
        /** mod の版（最後に登録した版）。 */
        version: text('version'),
        registeredAt: timestamp('registered_at').defaultNow().notNull(),
    },
    (table) => [
        primaryKey({ columns: [table.userId, table.kind, table.url, table.name] }),
        index('external_works_user_id_idx').on(table.userId),
    ],
);
