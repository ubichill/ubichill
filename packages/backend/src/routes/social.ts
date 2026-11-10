/**
 * ソーシャル: ユーザー検索・フレンド（申請・承認・解除）・フレンドの現在地・ブロック。
 * 関係と公開範囲の規則は shared の user/friends.ts、ブロックは user/blocks.ts（画面と同じ規則）。
 */
import {
    followerRepository,
    instanceRepository,
    type RemoteActorRecord,
    remoteFriendshipRepository,
    type UserProfileRecord,
    userBlockRepository,
    userFriendRepository,
    userRepository,
    userSettingsRepository,
} from '@ubichill/db';
import {
    BLOCK_REFUSAL_MESSAGES,
    type BlockedUser,
    BlockRequestSchema,
    type BlocksResponse,
    canSeeInstance,
    DEFAULT_PRESENCE_VISIBILITY,
    FEDERATION_FEATURES,
    type FriendRequestSummary,
    type Friendship,
    type FriendsResponse,
    friendGroupsOf,
    friendshipOf,
    groupFriendLocations,
    HANDLE_PATTERN,
    type Instance,
    isRemoteUserId,
    type PresenceVisibility,
    parseAuthorAccount,
    parseUserSearchQuery,
    type RemoteRelation,
    remoteProfileView,
    type UserProfileWithFriendship,
    type UserSearchResponse,
    type UserSummary,
    type UserWithFriendship,
    userProfileOf,
} from '@ubichill/shared';
import { type Response, Router } from 'express';
import { optionalAuth, requireAuth } from '../middleware/auth';
import { selfAccount, selfDomain } from '../services/authors/authorKeys';
import { federation } from '../services/federation';
import { friendshipViewOf } from '../services/federation/friendships';
import { type FriendPresence, limitFriendPresence, visitorVisibility } from '../services/federation/presence';
import { remoteInstanceOf } from '../services/federation/remoteInstance';
import { instanceManager } from '../services/instances/instanceManager';
import { instanceRuntime } from '../services/instances/instanceRuntime';
import { notificationService, notifyInBackground } from '../services/notifications/notificationService';
import { hasBlockedUser, hiddenIdsFor, isBlockedBetween } from '../services/social/blockCheck';
import { blockService } from '../services/social/blockService';
import { friendEdgesOf, friendIdsOf } from '../services/social/friends';
import { remoteSummaryOf, summariesOf, summaryOf } from '../services/social/userSummaries';
import { logger } from '../utils/logger';

const router = Router();

/** システムユーザーは検索・フレンドに出さない。 */
const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';
const SEARCH_LIMIT = 20;

/** プロフィール（ひとこと・リンクなど込み）と自分との関係。ユーザーページとリンクのプレビューに使う。 */
async function profileWithFriendship(
    viewerId: string | undefined,
    user: UserProfileRecord,
): Promise<UserProfileWithFriendship> {
    const [friendship, blocked] = viewerId
        ? await Promise.all([
              friendEdgesOf(viewerId).then((edges) => friendshipOf(edges, viewerId, user.id)),
              hasBlockedUser(viewerId, user.id),
          ])
        : (['none', false] as const);
    return { ...userProfileOf(user, selfAccount(user.handle)), friendship, ...blockedFlag(blocked) };
}

/** 見ている人がこの人をブロックしているときだけ付ける。 */
const blockedFlag = (blocked: boolean): { blocked?: true } => (blocked ? { blocked: true } : {});

// ── ほかのサーバーの人（連合） ──

/** ほかのサーバーの人との関係（このサーバーのフレンドと同じ語）。 */
const remoteFriendshipOf = async (viewerId: string | undefined, actorId: string): Promise<Friendship> =>
    viewerId ? friendshipViewOf(await remoteFriendshipRepository.get(viewerId, actorId)) : 'none';

/** 人として引ける actor（消えた actor・サーバーの actor は出さない）。 */
const personOf = (actor: RemoteActorRecord | null | undefined): RemoteActorRecord | null =>
    actor && !actor.deletedAt && actor.type === 'Person' ? actor : null;

/** フレンドに対応していないサーバーか・フェディバースでフォローされているか（申請のボタンの代わりに出す）。 */
async function remoteRelationOf(viewerId: string | undefined, actor: RemoteActorRecord): Promise<RemoteRelation> {
    const [unsupported, follow] = await Promise.all([
        federation?.servers.lacks(actor.domain, FEDERATION_FEATURES.friends).catch(() => false) ?? false,
        viewerId ? followerRepository.get(viewerId, actor.id) : undefined,
    ]);
    return { ...(unsupported ? { friendsUnsupported: true } : {}), ...(follow ? { followsYou: follow.state } : {}) };
}

/** ほかのサーバーの人のプロフィール（バナー・項目の表は取りに行った actor の文書から）。 */
async function remoteProfileWithFriendship(
    viewerId: string | undefined,
    actor: RemoteActorRecord,
): Promise<UserProfileWithFriendship> {
    const { fields, ...profile } = remoteProfileView(actor.profile);
    const blocked = viewerId ? await hasBlockedUser(viewerId, actor.id) : false;
    return {
        ...remoteSummaryOf(actor),
        author: actor.account,
        bannerImage: actor.banner,
        ...profile,
        ...(fields.length > 0 ? { fields } : {}),
        ...(await remoteRelationOf(viewerId, actor)),
        friendship: await remoteFriendshipOf(viewerId, actor.id),
        ...blockedFlag(blocked),
    };
}

/** actor の URL かアカウント（`handle@domain`）から、ほかのサーバーの人を引く。 */
async function findRemotePerson(ref: string): Promise<RemoteActorRecord | null> {
    if (!federation) return null;
    const actor = isRemoteUserId(ref) ? await federation.actors.get(ref) : await federation.actors.byAccount(ref);
    return personOf(actor);
}

/** 連合のフレンドの操作の失敗を返す。 */
const remoteUnavailable = (res: Response) => res.status(404).json({ error: 'ほかのサーバーの人が見つかりません' });

// ユーザー検索（ID の前方一致・表示名の部分一致・`@handle@domain` の指定）。自分との関係付き。
router.get('/users', requireAuth, async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const query = parseUserSearchQuery(typeof req.query.q === 'string' ? req.query.q : '', selfDomain());
    if (query.kind === 'tooLong') return res.status(400).json({ error: '検索語が長すぎます' });
    if (query.kind === 'empty') return res.json({ users: [] } satisfies UserSearchResponse);
    // ブロックした人は出さない
    const hidden = await hiddenIdsFor(req.user.id);
    // ほかのサーバーのアカウントは、そのサーバーに WebFinger で問い合わせて引く
    if (query.kind === 'remote') {
        const actor = await findRemotePerson(query.account).catch(() => null);
        if (!actor || hidden.has(actor.id))
            return res.json({ users: [], remoteAccount: query.account } satisfies UserSearchResponse);
        const [friendship, relation] = await Promise.all([
            remoteFriendshipOf(req.user.id, actor.id),
            remoteRelationOf(req.user.id, actor),
        ]);
        return res.json({
            users: [{ ...remoteSummaryOf(actor), ...relation, friendship }],
        } satisfies UserSearchResponse);
    }
    const [users, edges] = await Promise.all([
        query.kind === 'local'
            ? userRepository
                  .findByHandle(query.handle)
                  .then((u) => (u && u.id !== SYSTEM_USER_ID && !hidden.has(u.id) ? [u] : []))
            : userRepository.search(query, { limit: SEARCH_LIMIT, excludeIds: [SYSTEM_USER_ID, ...hidden] }),
        friendEdgesOf(req.user.id),
    ]);
    const me = req.user.id;
    return res.json({
        users: users.map((u): UserWithFriendship => ({ ...summaryOf(u), friendship: friendshipOf(edges, me, u.id) })),
    } satisfies UserSearchResponse);
});

// ID（/@handle）でユーザーを引く（ユーザーページ）。
router.get('/users/by-handle/:handle', optionalAuth, async (req, res) => {
    const handle = String(req.params.handle).toLowerCase();
    // `handle@domain`: このサーバーのアカウントならその ID、ほかのサーバーならそのサーバーに問い合わせる
    const account = handle.includes('@') ? parseAuthorAccount(handle) : null;
    if (account && account.domain !== selfDomain()) {
        const actor = await findRemotePerson(handle).catch(() => null);
        if (!actor) return res.status(404).json({ error: 'User not found' });
        return res.json(await remoteProfileWithFriendship(req.user?.id, actor));
    }
    if (account) {
        const local = await userRepository.findProfileByHandle(account.handle);
        if (!local) return res.status(404).json({ error: 'User not found' });
        return res.json(await profileWithFriendship(req.user?.id, local));
    }
    const user = HANDLE_PATTERN.test(handle) ? await userRepository.findProfileByHandle(handle) : undefined;
    if (!user) return res.status(404).json({ error: 'User not found' });
    return res.json(await profileWithFriendship(req.user?.id, user));
});

// 内部 ID でユーザーを引く（自分との関係付き）。
router.get('/users/:userId', optionalAuth, async (req, res) => {
    const userId = String(req.params.userId);
    if (isRemoteUserId(userId)) {
        const actor = await findRemotePerson(userId).catch(() => null);
        if (!actor) return res.status(404).json({ error: 'User not found' });
        return res.json(await remoteProfileWithFriendship(req.user?.id, actor));
    }
    const user = await userRepository.findProfileById(userId);
    if (!user || user.id === SYSTEM_USER_ID) return res.status(404).json({ error: 'User not found' });
    return res.json(await profileWithFriendship(req.user?.id, user));
});

// 自分のフレンド・自分への申請・自分の申請。
router.get('/friends', requireAuth, async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const me = req.user.id;
    const edges = await userFriendRepository.listForUser(me);
    const groups = friendGroupsOf(edges, me);
    const [friends, incomingUsers, outgoing] = await Promise.all([
        summariesOf(groups.friends),
        summariesOf(groups.incoming),
        summariesOf(groups.outgoing),
    ]);
    const requestedAt = (from: string) =>
        edges.find((e) => e.userId === from && e.friendId === me)?.createdAt.toISOString() ?? new Date(0).toISOString();
    // ほかのサーバーの人との関係（消えた actor は除いてある）
    const remote = await remoteFriendshipRepository.listForUser(me);
    const remoteOf = (state: string) =>
        remote
            .filter((r) => r.state === state)
            .map((r): UserSummary & { at: Date } => ({
                id: r.actorId,
                name: r.name ?? r.account.split('@')[0] ?? r.account,
                handle: r.account,
                image: r.icon,
                bio: r.summary,
                domain: r.domain,
                at: r.updatedAt,
            }));
    const strip = ({ at: _at, ...summary }: UserSummary & { at: Date }): UserSummary => summary;
    const incoming: FriendRequestSummary[] = [
        ...incomingUsers.map((u) => ({ ...u, requestedAt: requestedAt(u.id) })),
        ...remoteOf('incoming').map((r) => ({ ...strip(r), requestedAt: r.at.toISOString() })),
    ].sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
    return res.json({
        friends: [...friends, ...remoteOf('accepted').map(strip)],
        incoming,
        outgoing: [...outgoing, ...remoteOf('outgoing').map(strip)],
    } satisfies FriendsResponse);
});

// フレンドを申請する。相手から申請が来ていれば承認になる（お互いに申請したらフレンド）。
router.post('/friends', requireAuth, async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const me = req.user.id;
    const targetId = typeof req.body?.userId === 'string' ? req.body.userId : '';
    if (targetId && (await hasBlockedUser(me, targetId))) {
        return res.status(409).json({ error: 'ブロックを解除してから申請してください' });
    }
    if (isRemoteUserId(targetId)) {
        const actor = await findRemotePerson(targetId).catch(() => null);
        if (!actor || !federation) return remoteUnavailable(res);
        const outcome = await federation.friendships.request(me, actor);
        if (!outcome.ok) {
            return res.status(outcome.reason === 'gone' ? 404 : outcome.reason === 'unsupported' ? 422 : 403).json({
                error:
                    outcome.reason === 'gone'
                        ? 'このアカウントは消えています'
                        : outcome.reason === 'unsupported'
                          ? 'このサーバーはフレンドに対応していません'
                          : 'このサーバーの人とは、いまつながれません',
            });
        }
        return res.json({ friendship: outcome.friendship });
    }
    const target = targetId ? await userRepository.findById(targetId) : undefined;
    if (!target || target.id === SYSTEM_USER_ID) return res.status(404).json({ error: 'User not found' });
    if (target.id === me) return res.status(400).json({ error: '自分には申請できません' });
    // 相手にブロックされていたら、送ったように見せて何もしない（すぐに断られたのと見分けがつかない）
    if (await isBlockedBetween(me, target.id)) return res.json({ friendship: 'outgoing' satisfies Friendship });
    const edges = await userFriendRepository.requestOrAccept(me, target.id);
    const friendship = friendshipOf(edges, me, target.id);
    // 申請し直し・承認済みへの申請でも呼ぶ（同じ出来事は dedupeKey で 1 つにまとまる）
    if (friendship === 'outgoing') notifyInBackground(notificationService.followRequested(me, target.id), '申請');
    if (friendship === 'friends') notifyInBackground(notificationService.friendAccepted(me, target.id), '承認');
    return res.json({ friendship });
});

// 自分への申請を承認する。
router.post('/friends/:userId/accept', requireAuth, async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    if (isRemoteUserId(String(req.params.userId))) {
        const actor = await findRemotePerson(String(req.params.userId)).catch(() => null);
        if (!actor || !federation) return remoteUnavailable(res);
        if (!(await federation.friendships.accept(req.user.id, actor))) {
            return res.status(404).json({ error: '申請が見つかりません' });
        }
        return res.json({ friendship: 'friends' });
    }
    const accepted =
        !(await isBlockedBetween(req.user.id, String(req.params.userId))) &&
        (await userFriendRepository.accept(req.user.id, String(req.params.userId)));
    if (!accepted) return res.status(404).json({ error: '申請が見つかりません' });
    notifyInBackground(notificationService.friendAccepted(req.user.id, String(req.params.userId)), '承認');
    return res.json({ friendship: 'friends' });
});

// フレンドの解除・申請の取り消し・申請の拒否（どれも 2 人の関係を消す）。
router.delete('/friends/:userId', requireAuth, async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const otherId = String(req.params.userId);
    if (isRemoteUserId(otherId)) {
        // 相手の文書が引けなくても、こちらの関係は消せる（取り消し・解除の知らせは送れる相手にだけ送る）
        const actor = federation ? await federation.actors.get(otherId).catch(() => null) : null;
        const removed = actor
            ? await federation?.friendships.remove(req.user.id, actor)
            : (await remoteFriendshipRepository.remove(req.user.id, otherId)) !== undefined;
        if (!removed) return res.status(404).json({ error: 'フレンド・申請が見つかりません' });
        return res.status(204).send();
    }
    const removed = await userFriendRepository.remove(req.user.id, String(req.params.userId));
    if (!removed) return res.status(404).json({ error: 'フレンド・申請が見つかりません' });
    notifyInBackground(notificationService.friendshipRemoved(req.user.id, String(req.params.userId)), '関係の解消');
    return res.status(204).send();
});

// ブロックした人（新しい順）。作者アカウントは、この人が作った mod を読み込まないために画面が使う。
router.get('/blocks', requireAuth, async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const rows = await userBlockRepository.listForUser(req.user.id);
    const users = new Map((await summariesOf(rows.map((r) => r.blockedId))).map((u) => [u.id, u]));
    res.set('Cache-Control', 'no-store');
    return res.json({
        // 消えたユーザー・引けない actor も解除できるよう一覧に残す（名前は ID で代える）
        blocks: rows.map((r): BlockedUser => {
            const user = users.get(r.blockedId);
            const remote = isRemoteUserId(r.blockedId);
            return {
                ...(user ?? { id: r.blockedId, name: r.blockedId, handle: r.blockedId, image: null, bio: null }),
                blockedAt: r.createdAt.toISOString(),
                account: user ? (remote ? user.handle : selfAccount(user.handle)) : null,
            };
        }),
    } satisfies BlocksResponse);
});

// ブロックする。フレンド・申請・招待・通知を消し、ほかのサーバーの人ならフォロワーからも外す。
router.post('/blocks', requireAuth, async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const parsed = BlockRequestSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'userId が必要です' });
    const targetId = parsed.data.userId;
    const exists = isRemoteUserId(targetId)
        ? (await findRemotePerson(targetId).catch(() => null)) !== null
        : targetId !== SYSTEM_USER_ID && (await userRepository.findById(targetId)) !== undefined;
    if (!exists) return res.status(404).json({ error: 'User not found' });
    try {
        const outcome = await blockService.block(req.user.id, targetId);
        if (!outcome.ok) return res.status(400).json({ error: BLOCK_REFUSAL_MESSAGES[outcome.reason] });
        return res.status(204).send();
    } catch (error) {
        logger.error('ブロックの後片付けに失敗しました:', error);
        return res
            .status(503)
            .json({ error: 'ブロックしましたが、関係を消しきれませんでした。もう一度ブロックしてください' });
    }
});

// ブロックを解除する（消したフレンドの関係は戻さない）。
router.delete('/blocks/:userId', requireAuth, async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    if (!(await blockService.unblock(req.user.id, String(req.params.userId)))) {
        return res.status(404).json({ error: 'ブロックしていません' });
    }
    return res.status(204).send();
});

/**
 * フレンドの現在地。インスタンスごとにまとめ、フレンドの多い順。
 * 自分に見えないインスタンス（フレンドのみ・招待のみなど）にいるフレンドは、どこにいるかを出さず `private` にまとめる。
 * インスタンスにいないフレンドは `elsewhere`（オフラインかロビー）。
 * ほかのサーバーにつながらず確かめられないフレンドは `unreachable`（最後に確かめた場所と時刻を添える。いないとは言わない）。
 */
router.get('/locations', requireAuth, async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const me = req.user.id;
    const friendIds = [...(await friendIdsOf(me))];
    const myFriends = new Set(friendIds);
    // このサーバーのフレンドの見せ方（ほかのサーバーのフレンドは、そのホームが本人の設定で答える）
    const visibilities = await userSettingsRepository.presenceVisibilityOf(
        friendIds.filter((id) => !isRemoteUserId(id)),
    );
    const presence = await instanceRuntime.presence();
    const locationsByUser = new Map(
        [...presence.values()].flatMap((room) => room.memberIds.map((id) => [id, room.id] as const)),
    );
    // ここに来訪しているほかのサーバーのフレンドは、本人の見せ方をホームに確かめる（同じ部屋にいる人には見えているので尋ねない）
    const visitors = await visitorVisibilities(
        me,
        friendIds.filter(
            (id) =>
                isRemoteUserId(id) && locationsByUser.has(id) && locationsByUser.get(id) !== locationsByUser.get(me),
        ),
    );
    const visibilityOf = (id: string): PresenceVisibility =>
        isRemoteUserId(id) ? (visitors.get(id) ?? 'location') : (visibilities.get(id) ?? DEFAULT_PRESENCE_VISIBILITY);
    const hiddenIds = friendIds.filter((id) => visibilityOf(id) === 'hidden');
    const shownIds = friendIds.filter((id) => visibilityOf(id) !== 'hidden');
    const instanceIds = [...new Set(shownIds.flatMap((id) => locationsByUser.get(id) ?? []))];
    const records = (await Promise.all(instanceIds.map((id) => instanceRepository.findById(id)))).flatMap((r) =>
        r ? [r] : [],
    );
    const recordById = new Map(records.map((r) => [r.id, r]));
    const grouped = groupFriendLocations(
        shownIds,
        (userId) => recordById.get(locationsByUser.get(userId) ?? ''),
        (record, friendId) =>
            visibilityOf(friendId) === 'location' &&
            canSeeInstance(instanceManager.audienceOf(record, presence), me, myFriends),
    );
    const instances = (
        await Promise.all(grouped.locations.map((l) => instanceManager.getInstance(l.instance.id)))
    ).flatMap((i) => (i ? [i] : []));
    // 招待のみの部屋は見えても入れない（画面は「入る」ではなく「リクエスト」を出す）
    const withAccess = new Map(
        (await instanceManager.withViewerAccess(instances, me, myFriends, presence)).map((i) => [i.id, i]),
    );
    const localRooms = grouped.locations.flatMap((l) => {
        const instance = withAccess.get(l.instance.id);
        return instance ? [{ instance, friendIds: l.friendIds }] : [];
    });
    // このサーバーの部屋の外にいるフレンド: ほかのサーバーのフレンドはそのホームに、来訪中のフレンドは部屋のサーバーに尋ねる
    const remote = await remoteLocations(me, grouped.elsewhereIds, visibilityOf);
    const rooms = [...localRooms, ...remote.rooms];
    const privateIds = [...grouped.privateFriendIds, ...remote.privateIds];
    const elsewhere = [...grouped.elsewhereIds.filter((id) => !remote.placed.has(id)), ...hiddenIds];
    // ユーザーの情報は 1 回でまとめて引く（部屋ごとに引くと、部屋の数だけ DB に問い合わせる）
    const users = new Map(
        (
            await summariesOf([
                ...new Set([
                    ...rooms.flatMap((r) => r.friendIds),
                    ...privateIds,
                    ...elsewhere,
                    ...remote.unreachable.map((f) => f.friendId),
                ]),
            ])
        ).map((u) => [u.id, u]),
    );
    const pick = (ids: readonly string[]) => ids.flatMap((id) => users.get(id) ?? []);
    return res.json({
        locations: rooms
            .map((r) => ({ instance: r.instance, friends: pick(r.friendIds) }))
            .sort((a, b) => b.friends.length - a.friends.length),
        private: pick(privateIds),
        elsewhere: pick(elsewhere),
        unreachable: unreachableOf(remote.unreachable, users),
    });
});

/**
 * ここに来訪しているほかのサーバーのフレンドの見せ方（ホームの答えから）。尋ねられないとき（連合なし・失敗）は場所を伏せる。
 */
async function visitorVisibilities(
    me: string,
    visitorIds: readonly string[],
): Promise<Map<string, PresenceVisibility>> {
    if (visitorIds.length === 0) return new Map();
    const answers = federation
        ? await federation.presence.locate(me, { remote: visitorIds, localVisiting: [] }).catch((error: unknown) => {
              logger.warn('[federation] 来訪中のフレンドの見せ方を確かめられません:', error);
              return [];
          })
        : [];
    const byId = new Map(answers.map((a) => [a.friendId, a]));
    return new Map(visitorIds.map((id) => [id, visitorVisibility(byId.get(id))]));
}

/** 確かめられなかったフレンドと、最後に確かめた場所（ワールドの名前）と時刻。 */
function unreachableOf(found: readonly FriendPresence[], users: ReadonlyMap<string, UserSummary>) {
    return found.flatMap((f) => {
        const user = users.get(f.friendId);
        if (!user) return [];
        const last = f.lastKnown;
        return [
            {
                user,
                ...(last
                    ? {
                          lastKnown: {
                              at: new Date(last.at).toISOString(),
                              status: last.status,
                              ...(last.room ? { place: last.room.world.name } : {}),
                          },
                      }
                    : {}),
            },
        ];
    });
}

/** このサーバーの部屋の外にいるフレンドの現在地（連合）。尋ねられなかった人は elsewhere のまま。 */
async function remoteLocations(
    me: string,
    elsewhereIds: readonly string[],
    visibilityOf: (friendId: string) => PresenceVisibility,
) {
    const empty = {
        rooms: [] as Array<{ instance: Instance; friendIds: string[] }>,
        privateIds: [] as string[],
        unreachable: [] as FriendPresence[],
        placed: new Set<string>(),
    };
    if (!federation || elsewhereIds.length === 0) return empty;
    const found = await federation.presence
        .locate(me, {
            remote: elsewhereIds.filter(isRemoteUserId),
            localVisiting: elsewhereIds.filter((id) => !isRemoteUserId(id)),
        })
        .then((all) => all.map((f) => limitFriendPresence(f, visibilityOf(f.friendId))))
        .catch((error: unknown) => {
            logger.warn('[federation] フレンドの現在地を尋ねられません:', error);
            return [];
        });
    const inRooms = found.filter((f) => f.status === 'in_room' && f.room);
    const byRoom = Map.groupBy(inRooms, (f) => f.room?.id ?? '');
    const seenAt = new Date();
    const rooms = [...byRoom.values()].flatMap((group) => {
        const room = group[0]?.room;
        const address = room && federation?.identity.roomAddressOf(room.id);
        const domain = room && new URL(room.id).host;
        // このサーバーの部屋は、このサーバーの在室で出している
        if (!room || !address || !domain || domain === federation?.identity.domain) return [];
        const instance = remoteInstanceOf(room, {
            address,
            domain,
            canJoin: group.some((f) => f.joinable),
            seenAt,
        });
        return [{ instance, friendIds: group.map((f) => f.friendId) }];
    });
    const privateIds = found.filter((f) => f.status === 'private').map((f) => f.friendId);
    const unreachable = found.filter((f) => f.status === 'unreachable');
    return {
        rooms,
        privateIds,
        unreachable,
        placed: new Set(
            [...inRooms, ...found.filter((f) => f.status === 'private'), ...unreachable].map((f) => f.friendId),
        ),
    };
}

export { router };
