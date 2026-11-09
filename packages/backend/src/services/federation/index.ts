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
    instanceRepository,
    inviteRepository,
    remoteActorRepository,
    remoteFriendshipRepository,
    remoteServerRepository,
    remoteVisitRepository,
    userRepository,
    userSettingsRepository,
    worldRepository,
} from '@ubichill/db';
import {
    FEDERATION_FEATURES,
    FEDERATION_LIMITS,
    type FediverseSettings,
    type FediverseSettingsUpdate,
    isPublishable,
    parseRoomAddress,
    profileLanguagesView,
    profileLinksView,
    worldPagePath,
} from '@ubichill/shared';
import { appConfig } from '../../config';
import { safeFetch } from '../../lib/safeFetch';
import { logger } from '../../utils/logger';
import { selfAccount } from '../authors/authorKeys';
import { backendEvents } from '../cluster/backendEvents';
import { instanceManager } from '../instances/instanceManager';
import { instanceRuntime } from '../instances/instanceRuntime';
import { notificationService } from '../notifications/notificationService';
import { friendIdsOf } from '../social/friends';
import { publishedExternalEntries } from '../worlds/externalWorkStore';
import { nodeWorldCrypto } from '../worlds/worldCrypto';
import { worldRegistry } from '../worlds/worldRegistry';
import { createActorDirectory } from './actors';
import { type FederationConfig, federationConfigFromEnv } from './config';
import { createLocalActors } from './documents';
import { createDomainPolicies } from './domains';
import { createDebouncer, createFeatured, type FeaturedSource } from './featured';
import { createFollows } from './follows';
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
import { createRsaKeyring, verifyRsaSha256 } from './rsaKeys';
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
    const friendshipCheck = createFriendshipCheck({
        identity,
        transport,
        policyOf,
        async stateOf(userId, actorId) {
            const row = await remoteFriendshipRepository.get(userId, actorId);
            return row?.state === 'accepted'
                ? 'friends'
                : row?.state === 'outgoing' || row?.state === 'incoming'
                  ? row.state
                  : 'none';
        },
        visitOf,
        now,
    });

    /**
     * 関係を相手のホームに確かめ直す（届かなかった承認・解除・取り消しの埋め合わせ）。確かめていないもの・1 日たったものから。
     * つながらなければ確かめたことにしない（次の掃除でまた試す）。
     */
    const recheckFriendships = async (at: Date) => {
        const due = await remoteFriendshipRepository.dueForCheck(
            new Date(at.getTime() - FEDERATION_LIMITS.FRIENDSHIP_RECHECK_MS),
            FEDERATION_LIMITS.FRIENDSHIP_RECHECK_BATCH,
        );
        for (const row of due) {
            const actor = await actors.get(row.actorId).catch(() => null);
            if (!actor || actor.deletedAt) continue;
            if (await lacks(actor.domain, FEDERATION_FEATURES.friends)) {
                await remoteFriendshipRepository.markChecked(row.userId, row.actorId, at);
                continue;
            }
            const peer = await friendshipCheck.relationOf(row.actorId, identity.actorUrl(row.userId));
            if (!peer) continue;
            const result = await friendships.reconcile(row.userId, actor, peer);
            if (result !== 'kept')
                log(`フレンドの関係を相手とそろえました（${result}）: ${row.userId} ⇔ ${row.actorId}`);
            await remoteFriendshipRepository.markChecked(row.userId, row.actorId, at);
        }
    };
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
        async findUser(userId) {
            if (userId === SYSTEM_USER_ID) return undefined;
            const user = await userRepository.findProfileById(userId);
            return (
                user && {
                    id: user.id,
                    handle: user.handle,
                    name: user.name,
                    bio: user.bio ?? null,
                    image: user.image ?? null,
                    banner: user.bannerImage,
                    createdAt: user.createdAt,
                    profile: {
                        status: user.status,
                        links: profileLinksView(user.links),
                        languages: profileLanguagesView(user.languages),
                    },
                }
            );
        },
    });

    const featured = createFeatured({
        identity,
        profileOrigin: frontendOrigin,
        async findUser(userId) {
            if (userId === SYSTEM_USER_ID) return undefined;
            const user = await userRepository.findById(userId);
            return user && { id: user.id, handle: user.handle };
        },
        sources: {
            // ユーザーページの「作ったワールド」と同じ条件（署名して公開したもの・本人の署名で配られている外部のもの）
            async worlds(owner) {
                const own = await Promise.all(
                    (await worldRepository.findByAuthorId(owner.id)).map(async (record) => {
                        const world = await worldRegistry.getWorld(record.id);
                        return world && isPublishable(world.identity)
                            ? [
                                  {
                                      id: world.url,
                                      name: world.displayName,
                                      description: world.description ?? null,
                                      image: world.thumbnail ?? null,
                                      path: worldPagePath(world),
                                      published: record.createdAt,
                                  } satisfies FeaturedSource,
                              ]
                            : [];
                    }),
                );
                const external = (await publishedExternalEntries(owner.id, selfAccount(owner.handle))).flatMap(
                    (entry): FeaturedSource[] =>
                        entry.world
                            ? [
                                  {
                                      id: entry.world.url,
                                      name: entry.world.displayName,
                                      description: entry.world.description ?? null,
                                      image: entry.world.thumbnail ?? null,
                                      path: worldPagePath(entry.world),
                                      published: entry.registeredAt,
                                  },
                              ]
                            : [],
                );
                return [...own.flat(), ...external];
            },
            async mods(owner) {
                return (await publishedExternalEntries(owner.id, selfAccount(owner.handle))).flatMap(
                    (entry): FeaturedSource[] =>
                        entry.mod
                            ? [
                                  {
                                      id: `${entry.mod.url}\n${entry.mod.name}`,
                                      name: entry.mod.name,
                                      description: null,
                                      image: null,
                                      // mod のページは無いので、mod の並ぶユーザーページへ
                                      path: `/@${owner.handle}`,
                                      version: entry.mod.version,
                                      published: entry.registeredAt,
                                  },
                              ]
                            : [],
                );
            },
            async favorites(owner) {
                for (const entry of await favoriteRepository.latest(owner.id, 5)) {
                    const world = await worldRegistry.publishableListItem(entry.worldRef).catch(() => undefined);
                    if (world) {
                        return [
                            {
                                id: world.url,
                                name: world.displayName,
                                description: world.description ?? null,
                                image: world.thumbnail ?? null,
                                path: worldPagePath(world),
                                published: entry.createdAt,
                            },
                        ];
                    }
                }
                return [];
            },
        },
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
            await notifyFollowsRemoved([
                ...(await followerRepository.removeForDeletedActors()),
                ...(await Promise.all(blocked.map((p) => followerRepository.removeForDomain(p.domain)))).flat(),
            ]);
            await recheckFriendships(at).catch((error: unknown) =>
                log(`フレンドの関係を確かめられません: ${String(error)}`),
            );
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

/** 消したフォローのうち承認待ちだったものの知らせを片付ける。 */
async function notifyFollowsRemoved(rows: ReadonlyArray<{ userId: string; actorId: string; state: string }>) {
    await Promise.all(
        rows
            .filter((r) => r.state === 'pending')
            .map((r) =>
                notificationService
                    .fediverseFollowSettled(r.userId, r.actorId)
                    .catch((error: unknown) => logger.warn('通知の片付けに失敗:', error)),
            ),
    );
}

/** ドメインとの付き合い方を変えた（block ならフレンドとフォローを切り、ほかの backend にも読み直させる）。 */
export async function domainPolicyChanged(domain: string, policy: string | null): Promise<void> {
    await federation?.policies.reload();
    backendEvents.broadcast({ type: 'federation.policies.changed' });
    if (policy === 'block') {
        await notifyFriendshipsRemoved(await remoteFriendshipRepository.removeForDomain(domain));
        await notifyFollowsRemoved(await followerRepository.removeForDomain(domain));
    }
}

const config = federationConfigFromEnv(process.env);

/** 連合（種が無い・FEDERATION_ENABLED=false なら null）。 */
export const federation: Federation | null =
    config.enabled && config.seed ? createFederation({ ...config, seed: config.seed }) : null;

backendEvents.on('federation.policies.changed', () => federation?.policies.reload());
