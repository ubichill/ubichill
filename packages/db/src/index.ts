import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export { type AuthorBindingRecord, authorBindingRepository } from './repositories/authorBindingRepository';
export {
    type CliAuthRequestRecord,
    type CreateCliAuthRequestInput,
    cliAuthRequestRepository,
} from './repositories/cliAuthRequestRepository';
export { favoriteRepository } from './repositories/favoriteRepository';
export { federationPeerRepository } from './repositories/federationPeerRepository';
export { instanceRepository } from './repositories/instanceRepository';
export {
    type CreatePublishingEnvironmentInput,
    type PublishingEnvironmentRecord,
    publishingEnvironmentRepository,
} from './repositories/publishingEnvironmentRepository';
export { userFriendRepository } from './repositories/userFriendRepository';
export { userRepository } from './repositories/userRepository';
export { userSettingsRepository } from './repositories/userSettingsRepository';
export { worldRepository } from './repositories/worldRepository';

const connectionString = process.env.DATABASE_URL || 'postgresql://ubichill:password@127.0.0.1:5433/ubichill';

// Disable prefetch as it is not supported for "Transaction" pool mode
export const client = postgres(connectionString, { prepare: false });
export const db: PostgresJsDatabase<typeof schema> = drizzle(client, { schema });

export type {
    CreateFederationPeerInput,
    FederationPeerRecord,
} from './repositories/federationPeerRepository';
export type { CreateInstanceInput, InstanceRecord, UpdateInstanceInput } from './repositories/instanceRepository';
export type {
    CreateWorldInput,
    InsertWorldRecord,
    UpdateWorldInput,
    WorldRecord,
} from './repositories/worldRepository';
export {
    accounts,
    friendStatusEnum,
    insertInstanceSchema,
    insertUserFavoriteSchema,
    insertUserFriendSchema,
    insertUserSchema,
    insertUserSettingsSchema,
    insertWorldSchema,
    instances,
    instancesRelations,
    selectInstanceSchema,
    selectUserFavoriteSchema,
    selectUserFriendSchema,
    selectUserSchema,
    selectUserSettingsSchema,
    selectWorldSchema,
    sessions,
    userFavorites,
    userFavoritesRelations,
    userFriends,
    userFriendsRelations,
    userSettings,
    userSettingsRelations,
    users,
    usersRelations,
    verifications,
    worlds,
    worldsRelations,
} from './schema';
