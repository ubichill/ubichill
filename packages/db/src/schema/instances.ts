import { relations } from 'drizzle-orm';
import { integer, jsonb, pgEnum, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core';
import { nanoid } from 'nanoid';
import { users } from './users';
import { worlds } from './worlds';

export const instanceStatusEnum = pgEnum('instance_status', ['active', 'full', 'closing']);
export const instanceAccessTypeEnum = pgEnum('instance_access_type', [
    'public',
    'friend_plus',
    'friend_only',
    'invite_only',
]);

export const instances = pgTable('instances', {
    id: varchar('id', { length: 21 })
        .$defaultFn(() => nanoid())
        .primaryKey(),
    worldId: varchar('world_id', { length: 21 })
        .notNull()
        .references(() => worlds.id, { onDelete: 'cascade' }),
    leaderId: text('leader_id')
        .notNull()
        .references(() => users.id, { onDelete: 'cascade' }),
    status: instanceStatusEnum('status').notNull().default('active'),
    accessType: instanceAccessTypeEnum('access_type').notNull().default('public'),
    accessTags: jsonb('access_tags').$type<string[]>().default([]),
    hasPassword: text('has_password').default('false'),
    maxUsers: integer('max_users').notNull().default(10),
    currentUsers: integer('current_users').notNull().default(0),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    expiresAt: timestamp('expires_at'),
    // パスワード保護用（ハッシュ化して保存）
    passwordHash: varchar('password_hash', { length: 255 }),
});

export const instancesRelations = relations(instances, ({ one }) => ({
    world: one(worlds, {
        fields: [instances.worldId],
        references: [worlds.id],
    }),
    leader: one(users, {
        fields: [instances.leaderId],
        references: [users.id],
    }),
}));
