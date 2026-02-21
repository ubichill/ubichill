import { relations } from 'drizzle-orm';
import { boolean, pgEnum, pgTable, primaryKey, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { worlds } from './worlds';

export const friendStatusEnum = pgEnum('friend_status', ['pending', 'accepted']);

export const users = pgTable('users', {
    id: uuid('id').defaultRandom().primaryKey(),
    username: varchar('username', { length: 255 }).notNull(),
    email: varchar('email', { length: 255 }).notNull().unique(),
    passwordHash: varchar('password_hash', { length: 255 }),
    oauthProvider: varchar('oauth_provider', { length: 50 }),
    oauthId: varchar('oauth_id', { length: 255 }),
    profileImageUrl: varchar('profile_image_url', { length: 1024 }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const userSettings = pgTable('user_settings', {
    userId: uuid('user_id')
        .primaryKey()
        .references(() => users.id, { onDelete: 'cascade' }),
    disableExternalUrls: boolean('disable_external_urls').default(false).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const userFriends = pgTable(
    'user_friends',
    {
        userId: uuid('user_id')
            .notNull()
            .references(() => users.id, { onDelete: 'cascade' }),
        friendId: uuid('friend_id')
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
        userId: uuid('user_id')
            .notNull()
            .references(() => users.id, { onDelete: 'cascade' }),
        worldId: uuid('world_id')
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
