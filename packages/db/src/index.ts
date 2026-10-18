import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export {
    type AuthorKeyRepository,
    authorKeyRepository,
    type CreateLocalAuthorKeyInput,
    createAuthorKeyRepository,
    type RemoteAuthorKeyRecord,
    type RemoteAuthorRecord,
} from './repositories/authorKeyRepository';
export type { FetchedSigningKey, LocalAuthorKeyRecord } from './repositories/authorKeyRows';
export {
    type CliAuthRequestRecord,
    type CreateCliAuthRequestInput,
    cliAuthRequestRepository,
} from './repositories/cliAuthRequestRepository';
export type { NewCredentialUser } from './repositories/credentialUser';
export {
    type ExternalWorkKey,
    type ExternalWorkRecord,
    externalWorkRepository,
} from './repositories/externalWorkRepository';
export { favoriteRepository } from './repositories/favoriteRepository';
export { federationPeerRepository } from './repositories/federationPeerRepository';
export { instanceRepository } from './repositories/instanceRepository';
export {
    type LockedPendingRegistration,
    type PendingRegistrationEmailScope,
    type PendingRegistrationRecord,
    pendingRegistrationRepository,
} from './repositories/pendingRegistrationRepository';
export { type FriendRow, userFriendRepository } from './repositories/userFriendRepository';
export { type UserRecord, userRepository } from './repositories/userRepository';
export { userSettingsRepository } from './repositories/userSettingsRepository';
export { type PublishOutcome, type WorldTarget, worldRepository } from './repositories/worldRepository';
export { editorWorldOf, type ServedWorld, servedWorldOf, versionsToPrune } from './repositories/worldRows';
export { backfillWorldContentHashes, versionContentHash } from './worldContentHashBackfill';

const connectionString = process.env.DATABASE_URL || 'postgresql://ubichill:password@127.0.0.1:5433/ubichill';

export type Database = PostgresJsDatabase<typeof schema>;

/** 接続を作る（既定の db とは別の DB を使うテスト・ツール用。使い終わったら client.end() する）。 */
export function createDatabase(url: string): { client: postgres.Sql; db: Database } {
    // Disable prefetch as it is not supported for "Transaction" pool mode
    const client = postgres(url, { prepare: false });
    return { client, db: drizzle(client, { schema }) };
}

const defaultDatabase = createDatabase(connectionString);
export const client = defaultDatabase.client;
export const db: Database = defaultDatabase.db;

export type {
    CreateFederationPeerInput,
    FederationPeerRecord,
} from './repositories/federationPeerRepository';
export type { CreateInstanceInput, InstanceRecord, UpdateInstanceInput } from './repositories/instanceRepository';
export type {
    WorldDraftRecord,
    WorldRecord,
    WorldState,
    WorldVersionRecord,
} from './repositories/worldRows';
export {
    accounts,
    friendStatusEnum,
    insertInstanceSchema,
    insertUserFavoriteSchema,
    insertUserFriendSchema,
    insertUserSchema,
    insertUserSettingsSchema,
    instances,
    instancesRelations,
    pendingRegistrations,
    selectInstanceSchema,
    selectUserFavoriteSchema,
    selectUserFriendSchema,
    selectUserSchema,
    selectUserSettingsSchema,
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
    worldDrafts,
    worlds,
    worldsRelations,
    worldVersions,
} from './schema';
