import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export {
    accountDeletionRepository,
    type RetireOutcome,
} from './repositories/accountDeletionRepository';
export { type AnnouncementRecord, announcementRepository } from './repositories/announcementRepository';
export {
    type AuthorKeyRepository,
    authorKeyRepository,
    type CreateLocalAuthorKeyInput,
    createAuthorKeyRepository,
    type RemoteAuthorKeyRecord,
    type RemoteAuthorRecord,
} from './repositories/authorKeyRepository';
export type { FetchedSigningKey, LocalAuthorKeyRecord } from './repositories/authorKeyRows';
export { type BotProtectionRecord, botProtectionRepository } from './repositories/botProtectionRepository';
export {
    type CliAuthRequestRecord,
    type CreateCliAuthRequestInput,
    cliAuthRequestRepository,
} from './repositories/cliAuthRequestRepository';
export type { InsertCredentialUserOutcome, NewCredentialUser } from './repositories/credentialUser';
export {
    type ConversationRecord,
    type DirectMessageRecord,
    directMessageRepository,
    type MessageReactionRecord,
} from './repositories/directMessageRepository';
export {
    type EmailLinkRecord,
    emailLinkRepository,
    type LinkEmailOutcome,
    type LockedEmailLink,
} from './repositories/emailLinkRepository';
export {
    type ExternalWorkKey,
    type ExternalWorkRecord,
    externalWorkRepository,
} from './repositories/externalWorkRepository';
export { favoriteRepository } from './repositories/favoriteRepository';
export { type AddFeaturedServerOutcome, featuredServerRepository } from './repositories/featuredServerRepository';
export * from './repositories/federation';
export { federationPeerRepository } from './repositories/federationPeerRepository';
export {
    authFlowRepository,
    type CreateFediverseUserOutcome,
    type ExternalIdentity,
    fediverseAccountRepository,
    type LinkedFediverseAccount,
    type LinkOutcome,
    type NewFediverseUser,
    type UnlinkOutcome,
} from './repositories/fediverseAccountRepository';
export { instanceRepository } from './repositories/instanceRepository';
export { type InviteRecord, inviteRepository } from './repositories/inviteRepository';
export {
    type CreateNotificationInput,
    type NotificationRecord,
    notificationRepository,
} from './repositories/notificationRepository';
export {
    type LockedPendingRegistration,
    type PendingRegistrationEmailScope,
    type PendingRegistrationRecord,
    pendingRegistrationRepository,
} from './repositories/pendingRegistrationRepository';
export {
    type ProfileImageBlob,
    type ProfileImageRecordKind,
    profileImageRepository,
} from './repositories/profileImageRepository';
export {
    type RoleAssignmentRecord,
    type RoleMemberRecord,
    type RoleRecord,
    type RoleWithCountRecord,
    roleRepository,
} from './repositories/roleRepository';
export {
    type ServerBrandingRecord,
    type ServerImageBlob,
    type ServerImageRecordKind,
    serverBrandingRepository,
} from './repositories/serverBrandingRepository';
export { type ServerInfoRecord, serverInfoRepository } from './repositories/serverInfoRepository';
export { storageSettingsRepository } from './repositories/storageSettingsRepository';
export {
    type LockedTwoFactor,
    type TwoFactorChallengeRecord,
    type TwoFactorPatch,
    type TwoFactorRecord,
    twoFactorChallengeRepository,
    twoFactorRepository,
} from './repositories/twoFactorRepository';
export { type BlockRecord, userBlockRepository } from './repositories/userBlockRepository';
export { type FriendRow, userFriendRepository } from './repositories/userFriendRepository';
export {
    type AccountSessionRecord,
    type ProfileFieldsInput,
    type UserProfileRecord,
    type UserRecord,
    userRepository,
} from './repositories/userRepository';
export { userSettingsRepository } from './repositories/userSettingsRepository';
export {
    type AddWorldAssetOutcome,
    type RemovedWorldAsset,
    type WorldAssetBlob,
    type WorldAssetCursor,
    type WorldAssetRecord,
    type WorldAssetUse,
    worldAssetRepository,
} from './repositories/worldAssetRepository';
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
