import { sql } from 'drizzle-orm';
import { check, customType, integer, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core';

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
    dataType: () => 'bytea',
});

/**
 * サーバーのブランディングの略称とテーマの色（値の規則は shared の ServerBrandingUpdateSchema）。1 行だけ置き、無ければ既定。
 * server_info とは分ける（サーバー名が要る行を、色だけ決めたときに既定の名前で作らない）。
 */
export const serverBranding = pgTable(
    'server_branding',
    {
        id: text('id').primaryKey().default('current'),
        shortName: varchar('short_name', { length: 16 }),
        /** `#rrggbb` */
        themeColor: varchar('theme_color', { length: 7 }),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [check('server_branding_single_row', sql`${table.id} = 'current'`)],
);

/**
 * サーバーのアイコン・バナー（サーバーで作り直した PNG・WebP）。プロフィール画像と同じく中身を DB に置く。
 * 送った 1 枚から作るもの（shared の SERVER_IMAGE_VARIANTS）ごとに 1 行。置き換えると同じ種類（kind）の行をまとめて入れ替える。
 */
export const serverImages = pgTable(
    'server_images',
    {
        /** favicon / apple-touch-icon / icon-192 / icon-512 / banner */
        variant: text('variant').primaryKey(),
        /** 送った画像の種類（icon / banner）。まとめて入れ替える単位 */
        kind: text('kind').notNull(),
        /** 中身の SHA-256（base64url）。配信する URL に入れる */
        hash: text('hash').notNull(),
        contentType: text('content_type').notNull(),
        bytes: bytea('bytes').notNull(),
        width: integer('width').notNull(),
        height: integer('height').notNull(),
        createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    },
    (table) => [check('server_images_kind_check', sql`${table.kind} IN ('icon', 'banner')`)],
);
