import { sql } from 'drizzle-orm';
import { check, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core';

/**
 * サーバーの情報（コントロールパネルの「全般」。値の規則は shared の ServerInfoSchema）。行が無ければ既定の値を使う。1 行だけ置く。
 */
export const serverInfo = pgTable(
    'server_info',
    {
        id: text('id').primaryKey().default('current'),
        name: varchar('name', { length: 64 }).notNull(),
        description: text('description'),
        maintainerName: varchar('maintainer_name', { length: 64 }),
        maintainerEmail: text('maintainer_email'),
        tosUrl: text('tos_url'),
        privacyPolicyUrl: text('privacy_policy_url'),
        inquiryUrl: text('inquiry_url'),
        repositoryUrl: text('repository_url'),
        impressumUrl: text('impressum_url'),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [check('server_info_single_row', sql`${table.id} = 'current'`)],
);
