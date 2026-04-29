import { relations } from 'drizzle-orm';
import { boolean, pgEnum, pgTable, primaryKey, text, timestamp, varchar } from 'drizzle-orm/pg-core';
import { worlds } from './worlds';

export const friendStatusEnum = pgEnum('friend_status', ['pending', 'accepted']);

// Better Auth統合ユーザーテーブル
// Better Authが必要とするフィールド + アプリ独自のフィールド
export const users = pgTable('users', {
    // Better Auth required fields (text型、UUIDではなくnanoid)
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull().unique(),
    emailVerified: boolean('email_verified').notNull().default(false),
    image: text('image'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
    // App-specific fields
    username: varchar('username', { length: 255 }).unique(),
    profileImageUrl: varchar('profile_image_url', { length: 1024 }),
});

// Better Auth session table
export const sessions = pgTable('sessions', {
    id: text('id').primaryKey(),
    expiresAt: timestamp('expires_at').notNull(),
    token: text('token').notNull().unique(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
        .notNull()
        .references(() => users.id, { onDelete: 'cascade' }),
});

// Better Auth account table (for password/oauth)
export const accounts = pgTable('accounts', {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
        .notNull()
        .references(() => users.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at'),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
    scope: text('scope'),
    password: text('password'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// Better Auth verification table (for email verification)
export const verifications = pgTable('verifications', {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
});

export const userSettings = pgTable('user_settings', {
    userId: text('user_id')
        .primaryKey()
        .references(() => users.id, { onDelete: 'cascade' }),
    disableExternalUrls: boolean('disable_external_urls').default(false).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const userFriends = pgTable(
    'user_friends',
    {
        userId: text('user_id')
            .notNull()
            .references(() => users.id, { onDelete: 'cascade' }),
        friendId: text('friend_id')
            .notNull()
            .references(() => users.id, { onDelete: 'cascade' }),
        status: friendStatusEnum('status').default('pending').notNull(),
        createdAt: timestamp('created_at').defaultNow().notNull(),
    },
    (table) => [primaryKey({ columns: [table.userId, table.friendId] })],
);

export const userFavorites = pgTable(
    'user_favorites',
    {
        userId: text('user_id')
            .notNull()
            .references(() => users.id, { onDelete: 'cascade' }),
        worldId: varchar('world_id', { length: 21 })
            .notNull()
            .references(() => worlds.id, { onDelete: 'cascade' }),
        createdAt: timestamp('created_at').defaultNow().notNull(),
    },
    (table) => [primaryKey({ columns: [table.userId, table.worldId] })],
);

export const usersRelations = relations(users, ({ one, many }) => ({
    settings: one(userSettings),
    friends: many(userFriends, { relationName: 'userFriends' }),
    friendsOf: many(userFriends, { relationName: 'friendUsers' }),
    favorites: many(userFavorites),
    worlds: many(worlds),
}));

export const userSettingsRelations = relations(userSettings, ({ one }) => ({
    user: one(users, {
        fields: [userSettings.userId],
        references: [users.id],
    }),
}));

export const userFriendsRelations = relations(userFriends, ({ one }) => ({
    user: one(users, {
        fields: [userFriends.userId],
        references: [users.id],
        relationName: 'userFriends',
    }),
    friend: one(users, {
        fields: [userFriends.friendId],
        references: [users.id],
        relationName: 'friendUsers',
    }),
}));

export const userFavoritesRelations = relations(userFavorites, ({ one }) => ({
    user: one(users, {
        fields: [userFavorites.userId],
        references: [users.id],
    }),
    world: one(worlds, {
        fields: [userFavorites.worldId],
        references: [worlds.id],
    }),
}));
