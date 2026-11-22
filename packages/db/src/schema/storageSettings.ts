import { sql } from 'drizzle-orm';
import { bigint, check, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * ストレージの設定（コントロールパネルの「全般」。値の規則は shared の StorageQuotaInputSchema）。行が無ければ既定の値。1 行だけ置く。
 */
export const storageSettings = pgTable(
    'storage_settings',
    {
        id: text('id').primaryKey().default('current'),
        /** 1 人が置けるワールドの画像の合計（バイト） */
        worldAssetQuotaBytes: bigint('world_asset_quota_bytes', { mode: 'number' }).notNull(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [check('storage_settings_single_row', sql`${table.id} = 'current'`)],
);
