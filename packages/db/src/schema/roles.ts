import { boolean, index, integer, pgTable, primaryKey, text, timestamp, varchar } from 'drizzle-orm/pg-core';
import { users } from './users';

/**
 * ロール（Misskey のロールに合わせた属性）。入力の規則と判定は shared の user/roles.ts。
 * 公式アカウントはロールに関係なく管理者なので、ここには持たない。
 */
export const roles = pgTable('roles', {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description'),
    /** `#rrggbb`（小文字） */
    color: varchar('color', { length: 7 }).notNull(),
    /** プロフィールに出す */
    isPublic: boolean('is_public').notNull().default(false),
    /** 持っている人はこのサーバーの管理者 */
    isAdministrator: boolean('is_administrator').notNull().default(false),
    /** 大きいほど先に出す */
    displayOrder: integer('display_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** ロールのアサイン。期限（expires_at）を過ぎたものは無いのと同じで、定期の掃除で消す。 */
export const roleAssignments = pgTable(
    'role_assignments',
    {
        roleId: text('role_id')
            .notNull()
            .references(() => roles.id, { onDelete: 'cascade' }),
        userId: text('user_id')
            .notNull()
            .references(() => users.id, { onDelete: 'cascade' }),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        expiresAt: timestamp('expires_at', { withTimezone: true }),
    },
    (table) => [
        primaryKey({ name: 'role_assignments_pk', columns: [table.roleId, table.userId] }),
        index('role_assignments_user_idx').on(table.userId),
    ],
);
