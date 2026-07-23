import { WorldDefinitionSchema } from '@ubichill/shared';
import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';

export * from './federationPeers';
export * from './instances';
export * from './users';
export * from './worlds';

// Import from schemas
import { federationPeers } from './federationPeers';
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

// federation_peers
export const insertFederationPeerSchema = createInsertSchema(federationPeers);
export const selectFederationPeerSchema = createSelectSchema(federationPeers);

// worlds
export const insertWorldSchema = createInsertSchema(worlds, {
    definition: WorldDefinitionSchema,
});

export const selectWorldSchema = createSelectSchema(worlds, {
    definition: WorldDefinitionSchema,
});

// instances
export const insertInstanceSchema = createInsertSchema(instances, {
    accessTags: z.array(z.string()).optional().nullable(),
});

export const selectInstanceSchema = createSelectSchema(instances, {
    accessTags: z.array(z.string()).nullable(),
});
