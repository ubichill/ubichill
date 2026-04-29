import { WorldDefinitionSchema } from '@ubichill/shared';
import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';

export * from './instances';
export * from './users';
export * from './worlds';

// Import from schemas
import type { instances } from './instances';
import { userFavorites, userFriends, userSettings, users } from './users';
import type { worlds } from './worlds';

// users
export const insertUserSchema: z.ZodType<typeof users.$inferInsert> = createInsertSchema(users);
export const selectUserSchema: z.ZodType<typeof users.$inferSelect> = createSelectSchema(users);

// user_settings
export const insertUserSettingsSchema: z.ZodType<typeof userSettings.$inferInsert> = createInsertSchema(userSettings);
export const selectUserSettingsSchema: z.ZodType<typeof userSettings.$inferSelect> = createSelectSchema(userSettings);

// user_friends
export const insertUserFriendSchema: z.ZodType<typeof userFriends.$inferInsert> = createInsertSchema(userFriends);
export const selectUserFriendSchema: z.ZodType<typeof userFriends.$inferSelect> = createSelectSchema(userFriends);

// user_favorites
export const insertUserFavoriteSchema: z.ZodType<typeof userFavorites.$inferInsert> = createInsertSchema(userFavorites);
export const selectUserFavoriteSchema: z.ZodType<typeof userFavorites.$inferSelect> = createSelectSchema(userFavorites);

// worlds
export const insertWorldSchema: z.ZodType<typeof worlds.$inferInsert> = z.object({
    id: z.string().optional(),
    authorId: z.string(),
    name: z.string(),
    version: z.string(),
    definition: WorldDefinitionSchema,
    createdAt: z.date().optional(),
    updatedAt: z.date().optional(),
});

export const selectWorldSchema: z.ZodType<typeof worlds.$inferSelect> = z.object({
    id: z.string(),
    authorId: z.string(),
    name: z.string(),
    version: z.string(),
    definition: WorldDefinitionSchema,
    createdAt: z.date(),
    updatedAt: z.date(),
});

// instances
export const insertInstanceSchema: z.ZodType<typeof instances.$inferInsert> = z.object({
    id: z.string().optional(),
    worldId: z.string(),
    leaderId: z.string(),
    status: z.enum(['active', 'full', 'closing']).optional(),
    accessType: z.enum(['public', 'friend_plus', 'friend_only', 'invite_only']).optional(),
    accessTags: z.array(z.string()).optional().nullable(),
    hasPassword: z.boolean().optional(),
    maxUsers: z.number().optional(),
    currentUsers: z.number().optional(),
    createdAt: z.date().optional(),
    expiresAt: z.date().optional().nullable(),
    passwordHash: z.string().optional().nullable(),
});

export const selectInstanceSchema: z.ZodType<typeof instances.$inferSelect> = z.object({
    id: z.string(),
    worldId: z.string(),
    leaderId: z.string(),
    status: z.enum(['active', 'full', 'closing']),
    accessType: z.enum(['public', 'friend_plus', 'friend_only', 'invite_only']),
    accessTags: z.array(z.string()).nullable(),
    hasPassword: z.boolean(),
    maxUsers: z.number(),
    currentUsers: z.number(),
    createdAt: z.date(),
    expiresAt: z.date().nullable(),
    passwordHash: z.string().nullable(),
});
