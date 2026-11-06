import { sql } from 'drizzle-orm';
import { check, customType, integer, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';
import { users } from './users';

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
    dataType: () => 'bytea',
});

/**
 * アップロードしたプロフィール画像（サーバーで作り直した WebP）。オブジェクトストレージが無く backend が複数台なので
 * 中身を DB に置く。利用者・種類ごとに 1 枚で、置き換えると前の画像は消える（URL のハッシュが変わる）。
 */
export const profileImages = pgTable(
    'profile_images',
    {
        userId: text('user_id')
            .notNull()
            .references(() => users.id, { onDelete: 'cascade' }),
        /** avatar / banner */
        kind: text('kind').notNull(),
        /** 中身の SHA-256（base64url）。配信する URL に入れる */
        hash: text('hash').notNull(),
        contentType: text('content_type').notNull(),
        bytes: bytea('bytes').notNull(),
        width: integer('width').notNull(),
        height: integer('height').notNull(),
        createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    },
    (table) => [
        primaryKey({ columns: [table.userId, table.kind] }),
        check('profile_images_kind_check', sql`${table.kind} IN ('avatar', 'banner')`),
    ],
);
