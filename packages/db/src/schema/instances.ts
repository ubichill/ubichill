import { relations } from 'drizzle-orm';
import { boolean, index, integer, jsonb, pgEnum, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core';
import { nanoid } from 'nanoid';
import { users } from './users';

export const instanceStatusEnum = pgEnum('instance_status', ['active', 'full', 'closing']);
export const instanceAccessTypeEnum = pgEnum('instance_access_type', [
    'public',
    'friend_plus',
    'friend_only',
    'invite_only',
]);

export const instances = pgTable(
    'instances',
    {
        id: varchar('id', { length: 21 })
            .$defaultFn(() => nanoid())
            .primaryKey(),
        // ワールド参照＝正規 URL（worlds.id への FK を廃止。official/外部ワールドは DB に無い）
        worldRef: text('world_ref').notNull(),
        leaderId: text('leader_id')
            .notNull()
            .references(() => users.id, { onDelete: 'cascade' }),
        status: instanceStatusEnum('status').notNull().default('active'),
        accessType: instanceAccessTypeEnum('access_type').notNull().default('public'),
        accessTags: jsonb('access_tags').$type<string[]>().default([]),
        hasPassword: boolean('has_password').notNull().default(false),
        maxUsers: integer('max_users').notNull().default(10),
        currentUsers: integer('current_users').notNull().default(0),
        createdAt: timestamp('created_at').notNull().defaultNow(),
        expiresAt: timestamp('expires_at'),
        // パスワード保護用（ハッシュ化して保存）
        passwordHash: varchar('password_hash', { length: 255 }),
    },
    (table) => [
        index('instances_world_ref_idx').on(table.worldRef),
        index('instances_status_idx').on(table.status),
        index('instances_leader_id_idx').on(table.leaderId),
    ],
);

export const instancesRelations = relations(instances, ({ one }) => ({
    // world は URL 参照（worldRef）になったため drizzle リレーションは持たない
    leader: one(users, {
        fields: [instances.leaderId],
        references: [users.id],
    }),
}));
