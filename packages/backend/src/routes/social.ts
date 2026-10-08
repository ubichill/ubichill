/**
 * ソーシャル: ユーザー検索・フレンド（申請・承認・解除）・フレンドの現在地。
 * 関係と公開範囲の規則は shared の user/friends.ts（画面と同じ規則）。
 */
import { instanceRepository, type UserRecord, userFriendRepository, userRepository } from '@ubichill/db';
import {
    canSeeInstance,
    type FriendsResponse,
    friendGroupsOf,
    friendshipOf,
    groupFriendLocations,
    HANDLE_PATTERN,
    type Instance,
    parseUserSearchQuery,
    type UserSearchResponse,
    type UserSummary,
    type UserWithFriendship,
} from '@ubichill/shared';
import { Router } from 'express';
import { optionalAuth, requireAuth } from '../middleware/auth';
import { selfDomain } from '../services/authorKeys';
import { friendEdgesOf, friendIdsOf } from '../services/friends';
import { instanceManager } from '../services/instanceManager';
import { instanceRuntime } from '../services/instanceRuntime';

const router = Router();

/** システムユーザーは検索・フレンドに出さない。 */
const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';
const SEARCH_LIMIT = 20;

const summaryOf = (u: UserRecord): UserSummary => ({
    id: u.id,
    name: u.name,
    handle: u.handle ?? null,
    profileImageUrl: u.profileImageUrl ?? null,
    bio: u.bio ?? null,
});

async function summariesOf(ids: readonly string[]): Promise<UserSummary[]> {
    const users = await userRepository.findByIds(ids);
    const byId = new Map(users.map((u) => [u.id, u]));
    return ids.flatMap((id) => {
        const u = byId.get(id);
        return u ? [summaryOf(u)] : [];
    });
}

async function withFriendship(viewerId: string | undefined, user: UserRecord): Promise<UserWithFriendship> {
    const friendship = viewerId ? friendshipOf(await friendEdgesOf(viewerId), viewerId, user.id) : 'none';
    return { ...summaryOf(user), friendship };
}

// ユーザー検索（ID の前方一致・表示名の部分一致・`@handle@domain` の指定）。自分との関係付き。
router.get('/users', requireAuth, async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const query = parseUserSearchQuery(typeof req.query.q === 'string' ? req.query.q : '', selfDomain());
    if (query.kind === 'tooLong') return res.status(400).json({ error: '検索語が長すぎます' });
    if (query.kind === 'empty') return res.json({ users: [] } satisfies UserSearchResponse);
    // ほかのサーバーのアカウントは、連合のフレンド（#200）でそのサーバーに問い合わせるまで引けない
    if (query.kind === 'remote') {
        return res.json({ users: [], remoteAccount: query.account } satisfies UserSearchResponse);
    }
    const [users, edges] = await Promise.all([
        query.kind === 'local'
            ? userRepository.findByHandle(query.handle).then((u) => (u && u.id !== SYSTEM_USER_ID ? [u] : []))
            : userRepository.search(query, { limit: SEARCH_LIMIT, excludeIds: [SYSTEM_USER_ID] }),
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
    const user = HANDLE_PATTERN.test(handle) ? await userRepository.findByHandle(handle) : undefined;
    if (!user) return res.status(404).json({ error: 'User not found' });
    return res.json(await withFriendship(req.user?.id, user));
});

// 内部 ID でユーザーを引く（自分との関係付き）。
router.get('/users/:userId', optionalAuth, async (req, res) => {
    const user = await userRepository.findById(String(req.params.userId));
    if (!user || user.id === SYSTEM_USER_ID) return res.status(404).json({ error: 'User not found' });
    return res.json(await withFriendship(req.user?.id, user));
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
    const incoming = incomingUsers
        .map((u) => ({ ...u, requestedAt: requestedAt(u.id) }))
        .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
    return res.json({ friends, incoming, outgoing } satisfies FriendsResponse);
});

// フレンドを申請する。相手から申請が来ていれば承認になる（お互いに申請したらフレンド）。
router.post('/friends', requireAuth, async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const me = req.user.id;
    const targetId = typeof req.body?.userId === 'string' ? req.body.userId : '';
    const target = targetId ? await userRepository.findById(targetId) : undefined;
    if (!target || target.id === SYSTEM_USER_ID) return res.status(404).json({ error: 'User not found' });
    if (target.id === me) return res.status(400).json({ error: '自分には申請できません' });
    const edges = await userFriendRepository.requestOrAccept(me, target.id);
    return res.json({ friendship: friendshipOf(edges, me, target.id) });
});

// 自分への申請を承認する。
router.post('/friends/:userId/accept', requireAuth, async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const accepted = await userFriendRepository.accept(req.user.id, String(req.params.userId));
    if (!accepted) return res.status(404).json({ error: '申請が見つかりません' });
    return res.json({ friendship: 'friends' });
});

// フレンドの解除・申請の取り消し・申請の拒否（どれも 2 人の関係を消す）。
router.delete('/friends/:userId', requireAuth, async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const removed = await userFriendRepository.remove(req.user.id, String(req.params.userId));
    if (!removed) return res.status(404).json({ error: 'フレンド・申請が見つかりません' });
    return res.status(204).send();
});

/**
 * フレンドの現在地。インスタンスごとにまとめ、フレンドの多い順。
 * 自分に見えないインスタンス（フレンドのみ・招待のみなど）にいるフレンドは、どこにいるかを出さず `private` にまとめる。
 * インスタンスにいないフレンドは `elsewhere`（オフラインかロビー）。
 */
router.get('/locations', requireAuth, async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const me = req.user.id;
    const friendIds = [...(await friendIdsOf(me))];
    const myFriends = new Set(friendIds);
    const presence = await instanceRuntime.presence();
    const locationsByUser = new Map(
        [...presence.values()].flatMap((room) => room.memberIds.map((id) => [id, room.id] as const)),
    );
    const instanceIds = [...new Set(friendIds.flatMap((id) => locationsByUser.get(id) ?? []))];
    const records = (await Promise.all(instanceIds.map((id) => instanceRepository.findById(id)))).flatMap((r) =>
        r ? [r] : [],
    );
    const recordById = new Map(records.map((r) => [r.id, r]));
    const grouped = groupFriendLocations(
        friendIds,
        (userId) => recordById.get(locationsByUser.get(userId) ?? ''),
        (record) => canSeeInstance(instanceManager.audienceOf(record, presence), me, myFriends),
    );
    const locations = await Promise.all(
        grouped.locations.map(async (l) => ({
            instance: await instanceManager.getInstance(l.instance.id),
            friends: await summariesOf(l.friendIds),
        })),
    );
    return res.json({
        locations: locations.filter((l): l is { instance: Instance; friends: UserSummary[] } => !!l.instance),
        private: await summariesOf(grouped.privateFriendIds),
        elsewhere: await summariesOf(grouped.elsewhereIds),
    });
});

export { router };
