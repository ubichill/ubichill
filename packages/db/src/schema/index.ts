import { z } from "zod";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";

export * from "./instances";
export * from "./users";
export * from "./worlds";

// Import from schemas
import { instances } from "./instances";
import { userFavorites, userFriends, userSettings, users } from "./users";
import { worlds } from "./worlds";

// users
type InsertUser = typeof users.$inferInsert;
type SelectUser = typeof users.$inferSelect;
export const insertUserSchema: z.ZodType<InsertUser> =
  createInsertSchema(users);
export const selectUserSchema: z.ZodType<SelectUser> =
  createSelectSchema(users);

// user_settings
type InsertUserSettings = typeof userSettings.$inferInsert;
type SelectUserSettings = typeof userSettings.$inferSelect;
export const insertUserSettingsSchema: z.ZodType<InsertUserSettings> =
  createInsertSchema(userSettings);
export const selectUserSettingsSchema: z.ZodType<SelectUserSettings> =
  createSelectSchema(userSettings);

// user_friends
type InsertUserFriend = typeof userFriends.$inferInsert;
type SelectUserFriend = typeof userFriends.$inferSelect;
export const insertUserFriendSchema: z.ZodType<InsertUserFriend> =
  createInsertSchema(userFriends);
export const selectUserFriendSchema: z.ZodType<SelectUserFriend> =
  createSelectSchema(userFriends);

// user_favorites
type InsertUserFavorite = typeof userFavorites.$inferInsert;
type SelectUserFavorite = typeof userFavorites.$inferSelect;
export const insertUserFavoriteSchema: z.ZodType<InsertUserFavorite> =
  createInsertSchema(userFavorites);
export const selectUserFavoriteSchema: z.ZodType<SelectUserFavorite> =
  createSelectSchema(userFavorites);

// worlds
type InsertWorld = typeof worlds.$inferInsert;
type SelectWorld = typeof worlds.$inferSelect;
export const insertWorldSchema: z.ZodType<InsertWorld> =
  createInsertSchema(worlds);
export const selectWorldSchema: z.ZodType<SelectWorld> =
  createSelectSchema(worlds);

// instances
type InsertInstance = typeof instances.$inferInsert;
type SelectInstance = typeof instances.$inferSelect;
export const insertInstanceSchema: z.ZodType<InsertInstance> =
  createInsertSchema(instances);
export const selectInstanceSchema: z.ZodType<SelectInstance> =
  createSelectSchema(instances);
