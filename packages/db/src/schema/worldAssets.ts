import { customType, index, integer, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';
import { users } from './users';

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
    dataType: () => 'bytea',
});

/**
 * ワールドの作者が上げた画像（サーバーで作り直した WebP。core:image・背景に使う）。プロフィール画像と同じく中身を DB に置く。
 * URL は中身のハッシュで決まり、だれが上げても同じ画像は同じ URL になる。持ち主ごとに数と大きさの上限を掛ける。
 */
export const worldAssets = pgTable(
    'world_assets',
    {
        ownerId: text('owner_id')
            .notNull()
            .references(() => users.id, { onDelete: 'cascade' }),
        /** 中身の SHA-256（base64url）。配信する URL に入れる */
        hash: text('hash').notNull(),
        bytes: bytea('bytes').notNull(),
        byteSize: integer('byte_size').notNull(),
        width: integer('width').notNull(),
        height: integer('height').notNull(),
        createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    },
    (table) => [primaryKey({ columns: [table.ownerId, table.hash] }), index('world_assets_hash_idx').on(table.hash)],
);
