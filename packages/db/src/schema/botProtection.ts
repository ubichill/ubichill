import { sql } from 'drizzle-orm';
import { check, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * ボット対策の設定（コントロールパネルの「認証」）。行が無ければ使わない。1 行だけ置く。
 * シークレットキーはサーバーの秘密から作った鍵で暗号化する（backend の lib/secretBox.ts）。
 */
export const botProtectionSettings = pgTable(
    'bot_protection_settings',
    {
        id: text('id').primaryKey().default('current'),
        /** shared の BOT_PROTECTION_PROVIDERS のどれか */
        provider: text('provider').notNull(),
        siteKey: text('site_key').notNull(),
        secret: text('secret').notNull(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [check('bot_protection_settings_single_row', sql`${table.id} = 'current'`)],
);
