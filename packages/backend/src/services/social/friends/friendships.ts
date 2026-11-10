/**
 * フレンドの操作（申請・承認・解除）と一覧。関係の規則は shared の social/friends.ts、止めるかは interactionRefusal（relations）。
 * ほかのサーバーの人は連合（federation/ubichill/friendships.ts）に任せ、ここは同じ形の結果にそろえる。
 */
import type { FriendRow, RemoteActorRecord, RemoteFriendshipWithActor } from '@ubichill/db';
import {
    type CustomEmoji,
    type FriendRequestSummary,
    type Friendship,
    type FriendsResponse,
    friendGroupsOf,
    friendshipOf,
    isRemoteUserId,
    remoteEmojisOf,
    type UserSummary,
} from '@ubichill/shared';
import type { RemoteFriendships } from '../../federation/ubichill/friendships';
import type { People } from '../people';
import type { Relations } from '../relations';

export interface FriendshipServiceDeps {
    relations: Pick<Relations, 'interaction'>;
    people: Pick<People, 'findRemotePerson'>;
    local: {
        findUser(id: string): Promise<{ id: string } | undefined>;
        listForUser(userId: string): Promise<FriendRow[]>;
        requestOrAccept(from: string, to: string): Promise<FriendRow[]>;
        accept(me: string, from: string): Promise<boolean>;
        remove(a: string, b: string): Promise<boolean>;
    };
    remote: {
        /** 連合（無ければ null） */
        federation: Pick<RemoteFriendships, 'request' | 'accept' | 'remove'> | null;
        /** actor の文書（引けなければ null。消えた actor も返す: 解除の知らせを送るため） */
        actorOf(actorId: string): Promise<RemoteActorRecord | null>;
        listForUser(userId: string): Promise<RemoteFriendshipWithActor[]>;
        /** こちらの記録だけ消す（相手の文書が引けないとき） */
        removeRecord(userId: string, actorId: string): Promise<boolean>;
    };
    summariesOf(ids: readonly string[]): Promise<UserSummary[]>;
    systemUserId: string;
    notify: {
        followRequested(from: string, to: string): Promise<unknown>;
        friendAccepted(from: string, to: string): Promise<unknown>;
        friendshipRemoved(from: string, to: string): Promise<unknown>;
    };
    /** 通知の失敗で操作を失敗にしない */
    background(task: Promise<unknown>, what: string): void;
}

/** 申請できない理由（HTTP の対応は routes/social/friends.ts）。 */
export type FriendRequestRefusal =
    /** 自分がブロックしている（解除を促す） */
    | 'blocking'
    | 'self'
    | 'not-found'
    /** ほかのサーバーの人が引けない・連合が無い */
    | 'remote-unavailable'
    /** ほかのサーバーの人のアカウントが消えている */
    | 'gone'
    /** そのサーバーがフレンドに対応していない */
    | 'unsupported'
    /** そのドメインとは新しくつながれない */
    | 'domain-limited';

export type FriendRequestOutcome = { ok: true; friendship: Friendship } | { ok: false; reason: FriendRequestRefusal };

export type FriendAcceptOutcome = { ok: true } | { ok: false; reason: 'remote-unavailable' | 'no-request' };

const emojisOf = (profile: unknown): { emojis?: CustomEmoji[] } => {
    const emojis = remoteEmojisOf(profile);
    return emojis.length > 0 ? { emojis } : {};
};

const remoteSummaryOfRow = (r: RemoteFriendshipWithActor): UserSummary => ({
    id: r.actorId,
    name: r.name ?? r.account.split('@')[0] ?? r.account,
    handle: r.account,
    image: r.icon,
    bio: r.summary,
    domain: r.domain,
    ...emojisOf(r.profile),
});

export function createFriendshipService(deps: FriendshipServiceDeps) {
    const requestRemote = async (me: string, targetId: string): Promise<FriendRequestOutcome> => {
        const actor = await deps.people.findRemotePerson(targetId);
        if (!actor || !deps.remote.federation) return { ok: false, reason: 'remote-unavailable' };
        const outcome = await deps.remote.federation.request(me, actor);
        return outcome.ok ? { ok: true, friendship: outcome.friendship } : { ok: false, reason: outcome.reason };
    };

    return {
        /** 自分のフレンド・自分への申請（新しい順）・自分の申請。このサーバーの人が先、ほかのサーバーの人が後。 */
        async list(me: string): Promise<FriendsResponse> {
            const edges = await deps.local.listForUser(me);
            const groups = friendGroupsOf(edges, me);
            const [friends, incomingUsers, outgoing, remote] = await Promise.all([
                deps.summariesOf(groups.friends),
                deps.summariesOf(groups.incoming),
                deps.summariesOf(groups.outgoing),
                deps.remote.listForUser(me),
            ]);
            const requestedAt = (from: string) =>
                edges.find((e) => e.userId === from && e.friendId === me)?.createdAt.toISOString() ??
                new Date(0).toISOString();
            const remoteOf = (state: string) => remote.filter((r) => r.state === state);
            const incoming: FriendRequestSummary[] = [
                ...incomingUsers.map((u) => ({ ...u, requestedAt: requestedAt(u.id) })),
                ...remoteOf('incoming').map((r) => ({
                    ...remoteSummaryOfRow(r),
                    requestedAt: r.updatedAt.toISOString(),
                })),
            ].sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
            return {
                friends: [...friends, ...remoteOf('accepted').map(remoteSummaryOfRow)],
                incoming,
                outgoing: [...outgoing, ...remoteOf('outgoing').map(remoteSummaryOfRow)],
            };
        },

        /**
         * 申請する。相手から申請が来ていれば承認になる（お互いに申請したらフレンド）。
         * 相手にブロックされていたら、送ったように見せて何もしない（すぐに断られたのと見分けがつかない）。
         */
        async request(me: string, targetId: string): Promise<FriendRequestOutcome> {
            const refusal = targetId ? await deps.relations.interaction(me, targetId) : null;
            if (refusal === 'blocking') return { ok: false, reason: 'blocking' };
            if (isRemoteUserId(targetId)) return requestRemote(me, targetId);
            const target = targetId ? await deps.local.findUser(targetId) : undefined;
            if (!target || target.id === deps.systemUserId) return { ok: false, reason: 'not-found' };
            if (refusal === 'self') return { ok: false, reason: 'self' };
            if (refusal === 'blocked') return { ok: true, friendship: 'outgoing' };
            const friendship = friendshipOf(await deps.local.requestOrAccept(me, target.id), me, target.id);
            // 申請し直し・承認済みへの申請でも呼ぶ（同じ出来事は dedupeKey で 1 つにまとまる）
            if (friendship === 'outgoing') deps.background(deps.notify.followRequested(me, target.id), '申請');
            if (friendship === 'friends') deps.background(deps.notify.friendAccepted(me, target.id), '承認');
            return { ok: true, friendship };
        },

        /** 自分への申請を承認する。どちらかがブロックしていれば、申請が無いのと同じに答える。 */
        async accept(me: string, otherId: string): Promise<FriendAcceptOutcome> {
            if (isRemoteUserId(otherId)) {
                const actor = await deps.people.findRemotePerson(otherId);
                if (!actor || !deps.remote.federation) return { ok: false, reason: 'remote-unavailable' };
                return (await deps.remote.federation.accept(me, actor))
                    ? { ok: true }
                    : { ok: false, reason: 'no-request' };
            }
            const refusal = await deps.relations.interaction(me, otherId);
            const accepted = refusal !== 'blocking' && refusal !== 'blocked' && (await deps.local.accept(me, otherId));
            if (!accepted) return { ok: false, reason: 'no-request' };
            deps.background(deps.notify.friendAccepted(me, otherId), '承認');
            return { ok: true };
        },

        /** フレンドの解除・申請の取り消し・申請の拒否（どれも 2 人の関係を消す）。消すものが無ければ false。 */
        async remove(me: string, otherId: string): Promise<boolean> {
            if (isRemoteUserId(otherId)) {
                // 相手の文書が引けなくても、こちらの関係は消せる（取り消し・解除の知らせは送れる相手にだけ送る）
                const actor = deps.remote.federation ? await deps.remote.actorOf(otherId) : null;
                return actor
                    ? ((await deps.remote.federation?.remove(me, actor)) ?? false)
                    : deps.remote.removeRecord(me, otherId);
            }
            const removed = await deps.local.remove(me, otherId);
            if (removed) deps.background(deps.notify.friendshipRemoved(me, otherId), '関係の解消');
            return removed;
        },
    };
}

export type FriendshipService = ReturnType<typeof createFriendshipService>;
