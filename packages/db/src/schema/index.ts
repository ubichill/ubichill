import { createInsertSchema, createSelectSchema } from 'drizzle-zod';

export * from './instances';
export * from './users';
export * from './worlds';

// Import from schemas
import { instances } from './instances';
import { userFavorites, userFriends, userSettings, users } from './users';
import { worlds } from './worlds';

// users
export const insertUserSchema = createInsertSchema(users);
export const selectUserSchema = createSelectSchema(users);

// user_settings
export const insertUserSettingsSchema = createInsertSchema(userSettings);
export const selectUserSettingsSchema = createSelectSchema(userSettings);

// user_friends
export const insertUserFriendSchema = createInsertSchema(userFriends);
export const selectUserFriendSchema = createSelectSchema(userFriends);

// user_favorites
export const insertUserFavoriteSchema = createInsertSchema(userFavorites);
export const selectUserFavoriteSchema = createSelectSchema(userFavorites);

// worlds
export const insertWorldSchema = createInsertSchema(worlds);
export const selectWorldSchema = createSelectSchema(worlds);

// instances
export const insertInstanceSchema = createInsertSchema(instances);
export const selectInstanceSchema = createSelectSchema(instances);
