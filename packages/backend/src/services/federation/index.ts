/**
 * 連合の部品をつなぐ（DB・Go・通知・ワールドの解決）。部品の規則はそれぞれのファイルにあり、ここは配線だけ。
 * 種（FEDERATION_KEY_SEED。開発では BETTER_AUTH_SECRET から導く）が無ければ連合しない（federation は null）。
 */
import {
    actorKeyRepository,
    admissionRepository,
    deliveryRepository,
    domainPolicyRepository,
    favoriteRepository,
    federationSeenRepository,
    followerRepository,
    inviteRepository,
    remoteActorRepository,
    remoteFriendshipRepository,
    remoteServerRepository,
    remoteVisitRepository,
    userSettingsRepository,
} from '@ubichill/db';
import {
    FEDERATION_FEATURES,
    type FediverseSettings,
    type FediverseSettingsUpdate,
    parseRoomAddress,
} from '@ubichill/shared';
import { appConfig } from '../../config';
import { safeFetch } from '../../lib/safeFetch';
import { logger } from '../../utils/logger';
import { backendEvents } from '../cluster/backendEvents';
import { instanceManager } from '../instances/instanceManager';
import { instanceRuntime } from '../instances/instanceRuntime';
import { notificationService } from '../notifications/notificationService';
import { isBlockedBetween } from '../social/blockCheck';
import { friendIdsOf } from '../social/friends';
import { publishedWorks } from '../worlds/publishedWorkService';
import { nodeWorldCrypto } from '../worlds/worldCrypto';
import { worldRegistry } from '../worlds/worldRegistry';
import { type FederationConfig, federationConfigFromEnv } from './config';
import { createDebouncer, createFeatured } from './fediverse/featured';
import { createFeaturedSources } from './fediverse/featuredSources';
import { createFollows } from './fediverse/follows';
import { createFederationIdentity } from './identity';
import { createLocalStore } from './localStore';
import { createFederationMaintenance, severDomain } from './maintenance';
import { createActorDirectory } from './transport/actors';
import { createLocalActors } from './transport/documents';
import { createDomainPolicies } from './transport/domains';
import { createInbox } from './transport/inbox';
import { createKeyring } from './transport/keys';
import { createDeliveryWorker, createOutbox } from './transport/outbox';
import { createProfileAnnouncer } from './transport/profileUpdates';
import { createRsaKeyring, verifyRsaSha256 } from './transport/rsaKeys';
import { createServerDirectory } from './transport/servers';
import { createTransport } from './transport/transport';
import { createVerifier } from './transport/verification';
import { createFriendshipCheck } from './ubichill/friendshipCheck';
import { createRemoteFriendships } from './ubichill/friendships';
import { createFederatedInvites } from './ubichill/invites';
import { createFederatedPresence } from './ubichill/presence';
import { createRooms } from './ubichill/rooms';
import { createTravel } from './ubichill/travel';

const log = (message: string) => logger.warn(`[federation] ${message}`);

/** Go の WebSocket の絶対 URL（来訪者のブラウザがつなぐ）。 */
function absoluteWsUrl(publicUrl: string, origin: string): string {
    const url = new URL(publicUrl, origin);
    if (url.protocol === 'http:') url.protocol = 'ws:';
    if (url.protocol === 'https:') url.protocol = 'wss:';
    return url.href;
}

/** 画面のオリジン（プロフィールのリンク・来訪者のブラウザの origin の既定）。本番は PUBLIC_BASE_URL と同じ。 */
function frontendOriginOf(origin: string): string {
    const cors = appConfig.cors.origin;
    const first = Array.isArray(cors) ? cors.find((o) => o !== '*') : undefined;
    return first ? new URL(first).origin : origin;
}

function createFederation(config: FederationConfig & { seed: Uint8Array }) {
    const now = () => Date.now();
    const identity = createFederationIdentity(config.origin);
    const keyring = createKeyring({
        seed: config.seed,
        generation: config.keyGeneration,
        previousSeed: config.previousSeed,
    });
    const rsaKeys = createRsaKeyring({
        seed: config.seed,
        previousSeed: config.previousSeed,
        repo: actorKeyRepository,
        now,
    });
    const policies = createDomainPolicies({ list: () => domainPolicyRepository.list(), now });
    const policyOf = (domain: string) => policies.policyOf(domain);
    const transport = createTransport({
        identity,
        keyring,
        rsaKeys,
        fetch: safeFetch,
        now,
        // RFC 9421 の Ed25519 を告知しているサーバー（ubichill）だけ RFC 9421。知らないサーバーは Mastodon・Misskey と同じ方式
        async schemeFor(host) {
            const known = await remoteServerRepository.get(host);
            return known?.features.includes(FEDERATION_FEATURES.rfc9421Ed25519) ? 'rfc9421' : 'cavage';
        },
    });
    const actors = createActorDirectory({
        identity,
        allowHttp: config.allowHttp,
        repo: remoteActorRepository,
        servers: remoteServerRepository,
        transport,
        policyOf,
        now,
        log,
    });
    const servers = createServerDirectory({
        allowHttp: config.allowHttp,
        repo: remoteServerRepository,
        transport,
        appFeatures: async (url) => (await actors.get(url))?.features ?? null,
        now,
    });
    const verifier = createVerifier({
        identity,
        allowHttp: config.allowHttp,
        policyOf,
        actors,
        seen: federationSeenRepository,
        crypto: { verifyEd25519: nodeWorldCrypto.verifyEd25519, verifyRsaSha256 },
        now,
    });
    const outbox = createOutbox({ identity, repo: deliveryRepository, policyOf, now });
    const worker = createDeliveryWorker({
        repo: deliveryRepository,
        transport,
        servers,
        now,
        log,
        // 届けられなかった相手との関係は、次の掃除で相手のホームに確かめる（orderKey は `<送った actor>|<相手>`）
        gaveUp: async (delivery) => {
            const to = delivery.orderKey.split('|')[1];
            if (delivery.senderUserId && to) await remoteFriendshipRepository.markUnchecked(delivery.senderUserId, to);
        },
    });
    const local = createLocalStore(config.origin, now);
    const { userExists, isFriend, visitOf, visitsOf } = local;

    /** 相手のサーバーがその機能を持たないと分かっているか（送る・移動する前に、非対応を先に知らせる） */
    const lacks = (domain: string, feature: string) => servers.lacks(domain, feature);

    const friendships = createRemoteFriendships({
        identity,
        repo: remoteFriendshipRepository,
        userExists,
        blocked: isBlockedBetween,
        outbox,
        notify: notificationService,
        seen: federationSeenRepository,
        policyOf,
        lacks,
        now,
    });
    const friendshipCheck = createFriendshipCheck({
        identity,
        transport,
        policyOf,
        stateOf: local.friendshipStateOf,
        visitOf,
        now,
    });

    const rooms = createRooms({
        identity,
        allowHttp: config.allowHttp,
        policyOf,
        rooms: local.rooms,
        presence: () => instanceRuntime.presence(),
        friendsOf: (id) => friendIdsOf(id),
        askFriendship: (member, viewer) => friendshipCheck.ask(member, viewer),
        invites: {
            findValid: (instanceId, inviteeId, at) => inviteRepository.findValid(instanceId, inviteeId, at),
            upsert: (input) => inviteRepository.upsert(input),
        },
        admissions: admissionRepository,
        ticket: (instanceId, participant, origin) => instanceManager.visitorTicket(instanceId, participant, origin),
        wsUrl: absoluteWsUrl(appConfig.runtime.publicUrl, config.origin),
        now,
    });
    const travel = createTravel({
        identity,
        allowHttp: config.allowHttp,
        transport,
        policyOf,
        lacks,
        visits: remoteVisitRepository,
        now,
    });
    const presence = createFederatedPresence({
        identity,
        transport,
        policyOf,
        isFriend,
        visibilityOf: (userId) => userSettingsRepository.getPresenceVisibility(userId),
        async localRoomOf(userId) {
            const rooms = await instanceRuntime.presence();
            return [...rooms.values()].find((room) => room.memberIds.includes(userId))?.id;
        },
        describeRoom: (viewer, instanceId) => rooms.describe(viewer, instanceId),
        visitsOf,
        lacks,
        now,
    });
    const invites = createFederatedInvites({
        identity,
        allowHttp: config.allowHttp,
        actors,
        outbox,
        travel,
        roomCard: (instanceId) => rooms.card(instanceId),
        isFriend,
        friendIdsOf: (userId) => friendIdsOf(userId),
        visitOf,
        userExists,
        lacks,
        requests: inviteRepository,
        notify: notificationService,
        now,
    });
    const follows = createFollows({
        identity,
        repo: followerRepository,
        userExists,
        blocked: isBlockedBetween,
        settingsOf: (userId) => userSettingsRepository.getFediverse(userId),
        actorOf: async (actorId) => {
            const actor = await actors.get(actorId).catch(() => null);
            return actor && !actor.deletedAt ? actor : null;
        },
        outbox,
        notify: notificationService,
        seen: federationSeenRepository,
        policyOf,
        now,
    });
    const inbox = createInbox({
        seen: federationSeenRepository,
        friendships,
        follows,
        invites,
        actors: {
            refresh: (actorId) => actors.get(actorId, { refresh: true }),
            markDeleted: (actorId, at) => remoteActorRepository.markDeleted(actorId, at),
        },
        now,
    });
    const frontendOrigin = frontendOriginOf(config.origin);
    const localActors = createLocalActors({
        identity,
        keyring,
        rsaKeys,
        settingsOf: (userId) => userSettingsRepository.getFediverse(userId),
        followerCount: (userId) => followerRepository.countAccepted(userId),
        profileOrigin: frontendOrigin,
        findUser: local.profileOf,
    });

    const featured = createFeatured({
        identity,
        profileOrigin: frontendOrigin,
        findUser: local.ownerOf,
        sources: createFeaturedSources({
            published: publishedWorks,
            latestFavorites: (userId, limit) => favoriteRepository.latest(userId, limit),
            publishableListItem: (ref) => worldRegistry.publishableListItem(ref),
        }),
        favoritesVisibility: (userId) => userSettingsRepository.getFavoritesVisibility(userId),
        log,
    });

    const announceProfile = createProfileAnnouncer({
        identity,
        localActors,
        async audienceOf(userId) {
            const [friends, followers] = await Promise.all([
                remoteFriendshipRepository.acceptedActorsOf(userId),
                followerRepository.acceptedActorsOf(userId),
            ]);
            return [...new Set([...friends, ...followers.map((a) => a.id)])];
        },
        actors: remoteActorRepository,
        outbox,
    });

    const announceFeatured = createDebouncer(
        (userId) =>
            void announceProfile(userId).catch((error: unknown) =>
                log(`固定ノートの更新を届けられません: ${String(error)}`),
            ),
        30_000,
    );

    const maintenance = createFederationMaintenance({ identity, actors, friendships, friendshipCheck, lacks, log });

    return {
        config,
        identity,
        frontendOrigin,
        policies,
        actors,
        servers,
        verifier,
        outbox,
        worker,
        friendships,
        friendshipCheck,
        follows,
        featured,
        rooms,
        travel,
        presence,
        invites,
        inbox,
        localActors,
        isFriend,
        visitOf,
        visitsOf,
        /**
         * 固定ノートの中身が変わった（ワールドの公開・削除、外部の作品、お気に入りとその公開範囲）。覚えた分を捨て、
         * 続けて変えても 1 度にまとめて、フレンドとフォロワーに actor の取り直しを頼む。
         */
        featuredChanged(userId: string): void {
            featured.invalidate(userId);
            announceFeatured(userId);
        },
        /** プロフィールが変わったら、ほかのサーバーのフレンドに知らせる（失敗してもプロフィールの更新は止めない） */
        profileChanged(userId: string): void {
            void announceProfile(userId).catch((error: unknown) =>
                log(`プロフィールの更新を届けられません: ${String(error)}`),
            );
        },
        /**
         * フェディバースの設定を変える。承認制をやめたら承認待ちをまとめて承認し、actor の文書が変わったことを
         * フレンドとフォロワーに知らせる。
         */
        async updateFediverseSettings(userId: string, changes: FediverseSettingsUpdate): Promise<FediverseSettings> {
            const before = await userSettingsRepository.getFediverse(userId);
            const after = await userSettingsRepository.updateFediverse(userId, changes);
            await follows.settingsChanged(userId, before, after);
            void announceProfile(userId).catch((error: unknown) =>
                log(`プロフィールの更新を届けられません: ${String(error)}`),
            );
            return after;
        },
        /** 画面の住所がほかのサーバーの部屋なら、その住所（`{ id, domain }`） */
        remoteAddressOf(roomRef: string) {
            const address = parseRoomAddress(roomRef, identity.domain);
            return address?.domain ? { id: address.id, domain: address.domain } : null;
        },
        /** 期限の切れた記録・block したドメインと消えた actor との関係を消し、関係を確かめ直す（10 分ごとの掃除から）。 */
        sweep: maintenance.sweep,
    };
}

export type Federation = ReturnType<typeof createFederation>;

/** ドメインとの付き合い方を変えた（block ならフレンドとフォローを切り、ほかの backend にも読み直させる）。 */
export async function domainPolicyChanged(domain: string, policy: string | null): Promise<void> {
    await federation?.policies.reload();
    backendEvents.broadcast({ type: 'federation.policies.changed' });
    if (policy === 'block') await severDomain(domain);
}

const config = federationConfigFromEnv(process.env);

/** 連合（種が無い・FEDERATION_ENABLED=false なら null）。 */
export const federation: Federation | null =
    config.enabled && config.seed ? createFederation({ ...config, seed: config.seed }) : null;

backendEvents.on('federation.policies.changed', () => federation?.policies.reload());
