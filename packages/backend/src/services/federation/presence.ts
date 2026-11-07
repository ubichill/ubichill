/**
 * フレンドの現在地（連合）。現在地は配らず、見る人のホームが尋ねる（pull）。
 *
 * 答える（見られる人のホームとして）: 署名した人（見る人）とフレンドの、このサーバーのユーザーについてだけ答える。
 * - このサーバーの部屋にいる: 見る人に見えるか・入れるかを部屋の規則で決める（見えなければ private）
 * - ほかのサーバーの部屋に来訪中: その部屋のサーバーに、見る人に見えるかを尋ねる（部屋のことは部屋のサーバーが決める）
 * - どちらでもない・フレンドでない: offline（フレンドでない人には、いるかどうかも伏せる）
 *
 * 尋ねる（見る人のホームとして）: フレンドのホームごとにまとめて、見る人の鍵で尋ねる。答えは 15 秒使い回す。
 */
import {
    type DomainPolicy,
    exchanges,
    FEDERATION_LIMITS,
    FEDERATION_PATHS,
    hostOf,
    originOf,
    type PresenceEntry,
    PresenceResponseSchema,
    type RoomCard,
    SIGNATURE_TIMING,
    VisibilityResponseSchema,
} from '@ubichill/shared';
import { createTtlCache } from '../../utils/ttlCache';
import type { FederationIdentity } from './identity';
import type { Transport } from './transport';

export interface PresenceDeps {
    identity: FederationIdentity;
    transport: Pick<Transport, 'post'>;
    policyOf(domain: string): DomainPolicy;
    /** このサーバーのユーザーと actor がフレンドか */
    isFriend(userId: string, actorId: string): Promise<boolean>;
    /** このサーバーの部屋のうち、その人がいる部屋 */
    localRoomOf(userId: string): Promise<string | undefined>;
    /** 見る人にとっての部屋（rooms.describe。見えなければ undefined） */
    describeRoom(viewer: string, instanceId: string): Promise<{ room: RoomCard; canJoin: boolean } | undefined>;
    /** 来訪中のほかのサーバーの部屋（途切れていないもの） */
    visitsOf(userIds: readonly string[]): Promise<Array<{ userId: string; roomUrl: string; room: RoomCard }>>;
    now(): number;
}

/** 見る人から見た、フレンド 1 人の現在地。 */
export interface FriendPresence {
    /** このサーバーのユーザー ID か、ほかのサーバーの人の actor の URL */
    friendId: string;
    status: PresenceEntry['status'];
    room?: RoomCard;
    joinable?: boolean;
}

type Visibility = { visible: boolean; joinable: boolean; room: RoomCard | undefined };

export function createFederatedPresence(deps: PresenceDeps) {
    const visibilityCache = createTtlCache<Visibility | null>({ ttlMs: 30_000, max: 5000, now: deps.now });
    const presenceCache = createTtlCache<PresenceEntry[]>({
        ttlMs: FEDERATION_LIMITS.PRESENCE_TTL_SEC * 1000,
        max: 5000,
        now: deps.now,
    });

    /** 部屋のサーバーに、中にいる member のフレンド（viewer）に見えるかを尋ねる（Application actor の署名）。 */
    const askVisibility = (roomUrl: string, member: string, viewer: string): Promise<Visibility | null> =>
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
            const parsed = response?.status === 200 ? VisibilityResponseSchema.safeParse(response.json) : null;
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
        const answer = await askVisibility(visit.roomUrl, member, viewer);
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
            const presence = await Promise.all(
                friendsOfViewer.map(async ({ subject, userId }): Promise<PresenceEntry> => {
                    if (!userId) return { subject, status: 'offline' };
                    const instanceId = await deps.localRoomOf(userId);
                    if (instanceId) {
                        const described = await deps.describeRoom(viewer, instanceId);
                        return described
                            ? { subject, status: 'in_room', room: described.room, joinable: described.canJoin }
                            : { subject, status: 'private' };
                    }
                    const visit = visits.get(userId);
                    return visit
                        ? { subject, ...(await visitPresence(subject, viewer, visit)) }
                        : { subject, status: 'offline' };
                }),
            );
            return { presence, ttl: FEDERATION_LIMITS.PRESENCE_TTL_SEC };
        },

        /**
         * 見る人（このサーバーのユーザー）のフレンドのうち、このサーバーの部屋の外にいる人の現在地。
         * - ほかのサーバーのフレンド: その人のホームに、ホームごとにまとめて尋ねる
         * - このサーバーのフレンドで、ほかのサーバーの部屋に来訪中の人: 部屋のサーバーに尋ねる
         * 答えの無い人は offline（尋ねられなかった・つながらなかった）。
         */
        async locate(
            viewerId: string,
            friends: { remote: readonly string[]; localVisiting: readonly string[] },
        ): Promise<FriendPresence[]> {
            const viewer = deps.identity.actorUrl(viewerId);
            const byOrigin = Map.groupBy(
                friends.remote.filter((id) => {
                    const host = hostOf(id);
                    return !!host && exchanges(deps.policyOf(host));
                }),
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
                                const response = await deps.transport.post(
                                    `${origin}${FEDERATION_PATHS.rpc.presence}`,
                                    { subjects: ids },
                                    {
                                        signAs: { kind: 'user', userId: viewerId },
                                        ttlSec: SIGNATURE_TIMING.RPC_TTL_SEC,
                                        contentType: 'application/json',
                                        maxBytes: 256 * 1024,
                                    },
                                );
                                const parsed =
                                    response.status === 200 ? PresenceResponseSchema.safeParse(response.json) : null;
                                if (!parsed?.success) throw new Error(`presence: HTTP ${response.status}`);
                                return parsed.data.presence;
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
                            .catch((): FriendPresence[] => []),
                    ),
                )
            ).flat();
            const visits = await deps.visitsOf(friends.localVisiting);
            const visiting = await Promise.all(
                visits.map(async (visit) => ({
                    friendId: visit.userId,
                    ...(await visitPresence(deps.identity.actorUrl(visit.userId), viewer, visit)),
                })),
            );
            return [...remote, ...visiting];
        },
    };
}

export type FederatedPresence = ReturnType<typeof createFederatedPresence>;
