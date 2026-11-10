/**
 * フレンドの現在地（連合）。現在地は配らず、見る人のホームが尋ねる（pull）。
 *
 * 答える（見られる人のホームとして）: 署名した人（見る人）とフレンドの、このサーバーのユーザーについてだけ答える。
 * - このサーバーの部屋にいる: 見る人に見えるか・入れるかを部屋の規則で決める（見えなければ private）
 * - ほかのサーバーの部屋に来訪中: その部屋のサーバーに、見る人に見えるかを尋ねる（部屋のことは部屋のサーバーが決める）
 * - どちらでもない・フレンドでない: offline（フレンドでない人には、いるかどうかも伏せる）
 *
 * 尋ねる（見る人のホームとして）: フレンドのホームごとにまとめて、見る人の鍵で尋ねる。答えは 15 秒使い回す。
 * 相手のサーバーにつながらないときは unreachable（いないとは言わない）にして、最後に確かめた現在地（1 時間以内）を添える。
 */
import {
    type DomainPolicy,
    exchanges,
    FEDERATION_FEATURES,
    FEDERATION_LIMITS,
    FEDERATION_PATHS,
    hostOf,
    limitPresence,
    originOf,
    type PresenceEntry,
    PresenceResponseSchema,
    type PresenceVisibility,
    type RoomCard,
    SIGNATURE_TIMING,
    VisibilityResponseSchema,
} from '@ubichill/shared';
import { setBounded } from '../../../utils/boundedMap';
import { createTtlCache } from '../../../utils/ttlCache';
import type { FederationIdentity } from '../identity';
import type { Transport } from '../transport/transport';

export interface PresenceDeps {
    identity: FederationIdentity;
    transport: Pick<Transport, 'post'>;
    policyOf(domain: string): DomainPolicy;
    /** このサーバーのユーザーと actor がフレンドか */
    isFriend(userId: string, actorId: string): Promise<boolean>;
    /** このサーバーのユーザーが、オンライン状態をどこまで見せるか */
    visibilityOf(userId: string): Promise<PresenceVisibility>;
    /** このサーバーの部屋のうち、その人がいる部屋 */
    localRoomOf(userId: string): Promise<string | undefined>;
    /** 見る人にとっての部屋（rooms.describe。見えなければ undefined） */
    describeRoom(viewer: string, instanceId: string): Promise<{ room: RoomCard; canJoin: boolean } | undefined>;
    /** 来訪中のほかのサーバーの部屋（途切れていないもの） */
    visitsOf(userIds: readonly string[]): Promise<Array<{ userId: string; roomUrl: string; room: RoomCard }>>;
    /** 相手のサーバーがその機能を持たないと分かっているか（現在地に答えないサーバーには尋ねない） */
    lacks(domain: string, feature: string): Promise<boolean>;
    now(): number;
}

/** 見る人から見た、フレンド 1 人の現在地。unreachable は相手のサーバーにつながらず確かめられないこと。 */
export interface FriendPresence {
    /** このサーバーのユーザー ID か、ほかのサーバーの人の actor の URL */
    friendId: string;
    status: PresenceEntry['status'] | 'unreachable';
    room?: RoomCard;
    joinable?: boolean;
    /** unreachable のとき、最後に確かめた現在地と時刻（1 時間以内のもの） */
    lastKnown?: { status: PresenceEntry['status']; room?: RoomCard; at: number };
}

/**
 * このサーバーのフレンドの見せ方に合わせて、尋ねて分かった現在地を狭める（来訪中の部屋のサーバーは本人の設定を知らない）。
 * 場所を伏せるときは、最後に確かめた場所も伏せる。
 */
export function limitFriendPresence(found: FriendPresence, visibility: PresenceVisibility): FriendPresence {
    if (visibility === 'location') return found;
    if (visibility === 'hidden') return { friendId: found.friendId, status: 'offline' };
    const last = found.lastKnown;
    return {
        friendId: found.friendId,
        status: found.status === 'unreachable' ? 'unreachable' : limitPresence(found.status, visibility),
        ...(last ? { lastKnown: { status: limitPresence(last.status, visibility), at: last.at } } : {}),
    };
}

/**
 * ここに来訪しているほかのサーバーのフレンドを、このサーバーの在室で出してよいか（本人のホームの答えから）。
 * ホームは本人の見せ方を当てて答えるので、部屋にいると答えたときだけ場所を出す。場所を伏せた答え・つながらない・答えが無いときは
 * 部屋にいることだけ（private）、offline と答えたら（見せない人）部屋にいないことにする。
 */
export function visitorVisibility(home: FriendPresence | undefined): PresenceVisibility {
    if (home?.status === 'in_room') return 'location';
    if (home?.status === 'offline') return 'hidden';
    return 'online';
}

type Visibility = { visible: boolean; joinable: boolean; room: RoomCard | undefined };
/** 部屋のサーバーの答え: 見えるか / その人は部屋にいない（部屋も無い） / 答えられない（連合しない・読めない） */
type VisibilityAnswer = Visibility | 'absent' | null;

class Unreachable extends Error {}

const LAST_KNOWN_MS = 60 * 60 * 1000;

export function createFederatedPresence(deps: PresenceDeps) {
    const visibilityCache = createTtlCache<VisibilityAnswer>({ ttlMs: 30_000, max: 5000, now: deps.now });
    const lastKnown = new Map<string, NonNullable<FriendPresence['lastKnown']>>();
    const remember = (viewerId: string, found: FriendPresence) => {
        if (found.status === 'unreachable') return;
        setBounded(
            lastKnown,
            `${viewerId}|${found.friendId}`,
            { status: found.status, ...(found.room ? { room: found.room } : {}), at: deps.now() },
            5000,
        );
    };
    const unreachable = (viewerId: string, friendId: string): FriendPresence => {
        const last = lastKnown.get(`${viewerId}|${friendId}`);
        return {
            friendId,
            status: 'unreachable',
            ...(last && deps.now() - last.at < LAST_KNOWN_MS ? { lastKnown: last } : {}),
        };
    };
    const presenceCache = createTtlCache<PresenceEntry[]>({
        ttlMs: FEDERATION_LIMITS.PRESENCE_TTL_SEC * 1000,
        max: 5000,
        now: deps.now,
    });

    /**
     * 部屋のサーバーに、中にいる member のフレンド（viewer）に見えるかを尋ねる（Application actor の署名）。
     * つながらない・部屋のサーバーが答えられない（5xx）ときは Unreachable を投げる（キャッシュしない）。
     */
    const askVisibility = (roomUrl: string, member: string, viewer: string): Promise<VisibilityAnswer> =>
        visibilityCache.getOrCreate(`${roomUrl}|${member}|${viewer}`, async () => {
            const origin = originOf(roomUrl);
            const host = hostOf(roomUrl);
            if (!origin || !host || !exchanges(deps.policyOf(host))) return null;
            const response = await deps.transport
                .post(
                    `${origin}${FEDERATION_PATHS.rpc.visibility}`,
                    { room: roomUrl, member, viewers: [viewer] },
                    {
                        signAs: { kind: 'app' },
                        ttlSec: SIGNATURE_TIMING.RPC_TTL_SEC,
                        contentType: 'application/json',
                        maxBytes: 16 * 1024,
                    },
                )
                .catch(() => null);
            if (!response || response.status >= 500 || response.status === 429) throw new Unreachable(roomUrl);
            if (response.status === 404 || response.status === 409) return 'absent';
            const parsed = response.status === 200 ? VisibilityResponseSchema.safeParse(response.json) : null;
            const result = parsed?.success ? parsed.data.results.find((r) => r.viewer === viewer) : undefined;
            if (!parsed?.success || !result) return null;
            const room = parsed.data.room && parsed.data.room.id === roomUrl ? parsed.data.room : undefined;
            return { visible: result.visible, joinable: result.joinable, room };
        });

    /** 来訪中の人の現在地（部屋のサーバーが見えると答えたときだけ部屋を出す）。 */
    const visitPresence = async (
        member: string,
        viewer: string,
        visit: { roomUrl: string; room: RoomCard },
    ): Promise<Omit<FriendPresence, 'friendId'>> => {
        const answer = await askVisibility(visit.roomUrl, member, viewer).catch((error: unknown) => {
            if (error instanceof Unreachable) return 'unreachable' as const;
            throw error;
        });
        if (answer === 'unreachable') return { status: 'unreachable' };
        // 来訪の記録はあるが部屋にいない（出た知らせが届いていない）
        if (answer === 'absent') return { status: 'offline' };
        if (!answer?.visible) return { status: 'private' };
        return { status: 'in_room', room: answer.room ?? visit.room, joinable: answer.joinable };
    };

    return {
        /** `POST /federation/v1/presence`（見る人の鍵の署名）。 */
        async answer(viewer: string, subjects: readonly string[]): Promise<{ presence: PresenceEntry[]; ttl: number }> {
            const unique = [...new Set(subjects)].slice(0, FEDERATION_LIMITS.MAX_PRESENCE_SUBJECTS);
            const friendsOfViewer = await Promise.all(
                unique.map(async (subject) => {
                    const userId = deps.identity.localUserIdOf(subject);
                    return userId && (await deps.isFriend(userId, viewer))
                        ? { subject, userId }
                        : { subject, userId: null };
                }),
            );
            const visits = new Map(
                (await deps.visitsOf(friendsOfViewer.flatMap((f) => (f.userId ? [f.userId] : [])))).map((v) => [
                    v.userId,
                    v,
                ]),
            );
            // 部屋の規則で見る人に見えるか（本人の見せ方はこの後で狭める）
            const placeOf = async (subject: string, userId: string): Promise<PresenceEntry> => {
                const instanceId = await deps.localRoomOf(userId);
                if (instanceId) {
                    const described = await deps.describeRoom(viewer, instanceId);
                    return described
                        ? { subject, status: 'in_room', room: described.room, joinable: described.canJoin }
                        : { subject, status: 'private' };
                }
                const visit = visits.get(userId);
                if (!visit) return { subject, status: 'offline' };
                const { status, room, joinable } = await visitPresence(subject, viewer, visit);
                // 部屋のサーバーにつながらないときは、部屋にいる（どこかは伏せる）と答える（約束の状態に unreachable は無い）
                return status === 'unreachable'
                    ? { subject, status: 'private' }
                    : {
                          subject,
                          status,
                          ...(room ? { room } : {}),
                          ...(joinable !== undefined ? { joinable } : {}),
                      };
            };
            const presence = await Promise.all(
                friendsOfViewer.map(async ({ subject, userId }): Promise<PresenceEntry> => {
                    if (!userId) return { subject, status: 'offline' };
                    const visibility = await deps.visibilityOf(userId);
                    if (visibility === 'hidden') return { subject, status: 'offline' };
                    const entry = await placeOf(subject, userId);
                    const status = limitPresence(entry.status, visibility);
                    // 場所を伏せたら、部屋の情報も載せない
                    return status === entry.status ? entry : { subject, status };
                }),
            );
            return { presence, ttl: FEDERATION_LIMITS.PRESENCE_TTL_SEC };
        },

        /**
         * 見る人（このサーバーのユーザー）のフレンドのうち、このサーバーの部屋の外にいる人の現在地。
         * - ほかのサーバーのフレンド: その人のホームに、ホームごとにまとめて尋ねる
         * - このサーバーのフレンドで、ほかのサーバーの部屋に来訪中の人: 部屋のサーバーに尋ねる
         * つながらなかった人は unreachable（最後に確かめた現在地を添える）。答えに入っていない人は offline。
         */
        async locate(
            viewerId: string,
            friends: { remote: readonly string[]; localVisiting: readonly string[] },
        ): Promise<FriendPresence[]> {
            const viewer = deps.identity.actorUrl(viewerId);
            const hosts = [...new Set(friends.remote.flatMap((id) => hostOf(id) ?? []))];
            const answering = new Set(
                (
                    await Promise.all(
                        hosts.map(async (host) =>
                            exchanges(deps.policyOf(host)) && !(await deps.lacks(host, FEDERATION_FEATURES.presence))
                                ? [host]
                                : [],
                        ),
                    )
                ).flat(),
            );
            const byOrigin = Map.groupBy(
                friends.remote.filter((id) => answering.has(hostOf(id) ?? '')),
                (id) => originOf(id) ?? '',
            );
            const chunks = [...byOrigin].flatMap(([origin, ids]) =>
                Array.from({ length: Math.ceil(ids.length / FEDERATION_LIMITS.MAX_PRESENCE_SUBJECTS) }, (_, i) => ({
                    origin,
                    ids: ids.slice(
                        i * FEDERATION_LIMITS.MAX_PRESENCE_SUBJECTS,
                        (i + 1) * FEDERATION_LIMITS.MAX_PRESENCE_SUBJECTS,
                    ),
                })),
            );
            const remote = (
                await Promise.all(
                    chunks.map(({ origin, ids }) =>
                        presenceCache
                            .getOrCreate(`${viewerId}|${origin}|${ids.join(',')}`, async () => {
                                const response = await deps.transport
                                    .post(
                                        `${origin}${FEDERATION_PATHS.rpc.presence}`,
                                        { subjects: ids },
                                        {
                                            signAs: { kind: 'user', userId: viewerId },
                                            ttlSec: SIGNATURE_TIMING.RPC_TTL_SEC,
                                            contentType: 'application/json',
                                            maxBytes: 256 * 1024,
                                        },
                                    )
                                    .catch(() => {
                                        throw new Unreachable(origin);
                                    });
                                if (response.status >= 500 || response.status === 429) throw new Unreachable(origin);
                                const parsed =
                                    response.status === 200 ? PresenceResponseSchema.safeParse(response.json) : null;
                                // 答えない（403 など）・読めない答え: その人たちは offline
                                return parsed?.success ? parsed.data.presence : [];
                            })
                            .then((entries) => {
                                const asked = new Set(ids);
                                // 尋ねた人の答えだけを使う（ほかの人の現在地を混ぜさせない）
                                return entries.flatMap((e): FriendPresence[] =>
                                    asked.has(e.subject)
                                        ? [
                                              {
                                                  friendId: e.subject,
                                                  status: e.status === 'in_room' && !e.room ? 'private' : e.status,
                                                  ...(e.status === 'in_room' && e.room
                                                      ? { room: e.room, joinable: e.joinable ?? false }
                                                      : {}),
                                              },
                                          ]
                                        : [],
                                );
                            })
                            .catch((): FriendPresence[] => ids.map((id) => unreachable(viewerId, id))),
                    ),
                )
            ).flat();
            const visits = await deps.visitsOf(friends.localVisiting);
            const visiting = await Promise.all(
                visits.map(async (visit): Promise<FriendPresence> => {
                    const found = await visitPresence(deps.identity.actorUrl(visit.userId), viewer, visit);
                    return found.status === 'unreachable'
                        ? unreachable(viewerId, visit.userId)
                        : { friendId: visit.userId, ...found };
                }),
            );
            const found = [...remote, ...visiting];
            for (const f of found) remember(viewerId, f);
            return found;
        },
    };
}

export type FederatedPresence = ReturnType<typeof createFederatedPresence>;
