/**
 * 連合の部品をつなぐ（DB・Go・通知・ワールドの解決）。部品の規則はそれぞれのファイルにあり、ここは配線だけ。
 * 種（FEDERATION_KEY_SEED。開発では BETTER_AUTH_SECRET から導く）が無ければ連合しない（federation は null）。
 */
import {
    admissionRepository,
    deliveryRepository,
    domainPolicyRepository,
    federationSeenRepository,
    instanceRepository,
    inviteRepository,
    remoteActorRepository,
    remoteFriendshipRepository,
    remoteServerRepository,
    remoteVisitRepository,
    userRepository,
} from '@ubichill/db';
import { FEDERATION_LIMITS, parseRoomAddress } from '@ubichill/shared';
import { appConfig } from '../../config';
import { safeFetch } from '../../lib/safeFetch';
import { logger } from '../../utils/logger';
import { backendEvents } from '../cluster/backendEvents';
import { instanceManager } from '../instances/instanceManager';
import { instanceRuntime } from '../instances/instanceRuntime';
import { notificationService } from '../notifications/notificationService';
import { friendIdsOf } from '../social/friends';
import { nodeWorldCrypto } from '../worlds/worldCrypto';
import { worldRegistry } from '../worlds/worldRegistry';
import { createActorDirectory } from './actors';
import { type FederationConfig, federationConfigFromEnv } from './config';
import { createLocalActors } from './documents';
import { createDomainPolicies } from './domains';
import { createFriendshipCheck } from './friendshipCheck';
import { createRemoteFriendships } from './friendships';
import { createFederationIdentity } from './identity';
import { createInbox } from './inbox';
import { createFederatedInvites } from './invites';
import { createKeyring } from './keys';
import { createDeliveryWorker, createOutbox } from './outbox';
import { createFederatedPresence } from './presence';
import { createProfileAnnouncer } from './profileUpdates';
import { createRooms } from './rooms';
import { createServerDirectory } from './servers';
import { createTransport } from './transport';
import { createTravel } from './travel';
import { createVerifier } from './verification';

const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';
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
    const keyring = createKeyring(config.seed);
    const policies = createDomainPolicies({ list: () => domainPolicyRepository.list(), now });
    const policyOf = (domain: string) => policies.policyOf(domain);
    const transport = createTransport({ identity, keyring, fetch: safeFetch, now });
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
        crypto: nodeWorldCrypto,
        now,
    });
    const outbox = createOutbox({ identity, repo: deliveryRepository, policyOf, now });
    const worker = createDeliveryWorker({ repo: deliveryRepository, transport, servers, now, log });
    const userExists = async (userId: string) =>
        userId !== SYSTEM_USER_ID && (await userRepository.findById(userId)) !== undefined;
    const isFriend = async (userId: string, actorId: string) =>
        (await remoteFriendshipRepository.get(userId, actorId))?.state === 'accepted';
    const visitsOf = (userIds: readonly string[]) =>
        remoteVisitRepository.listFresh(userIds, new Date(now() - FEDERATION_LIMITS.VISIT_STALE_MS));
    const visitOf = async (userId: string) =>
        remoteVisitRepository.get(userId, new Date(now() - FEDERATION_LIMITS.VISIT_STALE_MS));

    /** 相手のサーバーがその機能を持たないと分かっているか（送る・移動する前に、非対応を先に知らせる） */
    const lacks = (domain: string, feature: string) => servers.lacks(domain, feature);

    const friendships = createRemoteFriendships({
        identity,
        repo: remoteFriendshipRepository,
        userExists,
        outbox,
        notify: notificationService,
        seen: federationSeenRepository,
        policyOf,
        lacks,
        now,
    });
    const friendshipCheck = createFriendshipCheck({ identity, transport, policyOf, isFriend, visitOf, now });
    const rooms = createRooms({
        identity,
        allowHttp: config.allowHttp,
        policyOf,
        rooms: {
            async find(instanceId) {
                const record = await instanceRepository.findById(instanceId);
                return (
                    record && {
                        id: record.id,
                        leaderId: record.leaderId,
                        accessType: record.accessType,
                        maxUsers: record.maxUsers,
                        worldRef: record.worldRef,
                    }
                );
            },
            async look(record) {
                const world = await worldRegistry.getWorldByUrl(record.worldRef);
                return (
                    world && {
                        name: world.displayName,
                        image: world.thumbnail ? new URL(world.thumbnail, config.origin).href : null,
                    }
                );
            },
        },
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
    const inbox = createInbox({
        seen: federationSeenRepository,
        friendships,
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
        profileOrigin: frontendOrigin,
        async findUser(userId) {
            if (userId === SYSTEM_USER_ID) return undefined;
            const user = await userRepository.findById(userId);
            return (
                user && {
                    id: user.id,
                    handle: user.handle,
                    name: user.name,
                    bio: user.bio ?? null,
                    image: user.image ?? null,
                }
            );
        },
    });

    const announceProfile = createProfileAnnouncer({
        identity,
        localActors,
        friendsOf: (userId) => remoteFriendshipRepository.acceptedActorsOf(userId),
        actors: remoteActorRepository,
        outbox,
    });

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
        rooms,
        travel,
        presence,
        invites,
        inbox,
        localActors,
        isFriend,
        visitOf,
        visitsOf,
        /** プロフィールが変わったら、ほかのサーバーのフレンドに知らせる（失敗してもプロフィールの更新は止めない） */
        profileChanged(userId: string): void {
            void announceProfile(userId).catch((error: unknown) =>
                log(`プロフィールの更新を届けられません: ${String(error)}`),
            );
        },
        /** 画面の住所がほかのサーバーの部屋なら、その住所（`{ id, domain }`） */
        remoteAddressOf(roomRef: string) {
            const address = parseRoomAddress(roomRef, identity.domain);
            return address?.domain ? { id: address.id, domain: address.domain } : null;
        },
        /**
         * 期限の切れた記録を消す（10 分ごとの掃除から）。
         * block したドメイン・消えた actor との関係も消し直す（ほかの backend が古い方針のまま受けた申請や、
         * 消えた知らせと行き違って書かれた関係が残らないように）。
         */
        async sweep(at = new Date()) {
            const blocked = (await domainPolicyRepository.list()).filter((p) => p.policy === 'block');
            const removed = [
                ...(await remoteFriendshipRepository.removeForDeletedActors()),
                ...(await Promise.all(blocked.map((p) => remoteFriendshipRepository.removeForDomain(p.domain)))).flat(),
            ];
            await notifyFriendshipsRemoved(removed);
            await Promise.all([
                federationSeenRepository.deleteExpired(at),
                remoteVisitRepository.deleteStale(new Date(at.getTime() - FEDERATION_LIMITS.VISIT_STALE_MS)),
                remoteFriendshipRepository.deleteStale(
                    new Date(at.getTime() - FEDERATION_LIMITS.FRIEND_REQUEST_EXPIRE_MS),
                    new Date(at.getTime() - FEDERATION_LIMITS.REJECT_COOLDOWN_MS),
                ),
            ]);
        },
    };
}

export type Federation = ReturnType<typeof createFederation>;

/** 消したほかのサーバーの人とのフレンドを、このサーバーの人に知らせる（失敗しても残りは知らせる）。 */
async function notifyFriendshipsRemoved(rows: ReadonlyArray<{ userId: string; actorId: string }>): Promise<void> {
    await Promise.all(
        rows.map((r) =>
            notificationService
                .remoteFriendshipRemoved(r.userId, r.actorId)
                .catch((error: unknown) => logger.warn('通知の片付けに失敗:', error)),
        ),
    );
}

/** ドメインとの付き合い方を変えた（block ならフレンドを切り、ほかの backend にも読み直させる）。 */
export async function domainPolicyChanged(domain: string, policy: string | null): Promise<void> {
    await federation?.policies.reload();
    backendEvents.broadcast({ type: 'federation.policies.changed' });
    if (policy === 'block') await notifyFriendshipsRemoved(await remoteFriendshipRepository.removeForDomain(domain));
}

const config = federationConfigFromEnv(process.env);

/** 連合（種が無い・FEDERATION_ENABLED=false なら null）。 */
export const federation: Federation | null =
    config.enabled && config.seed ? createFederation({ ...config, seed: config.seed }) : null;

backendEvents.on('federation.policies.changed', () => federation?.policies.reload());
