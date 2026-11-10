/**
 * フェディバース（Mastodon・Misskey など）からのフォロー（Follow → Accept / Reject、やめるのは Undo{Follow}）。
 * フレンドとは別の片方向の関係で、フォロワーに見えるのはプロフィールだけ（現在地・来訪・招待はフレンドだけ）。
 *
 * - 承認制でなければすぐ Accept、承認制なら承認待ちにして本人に知らせる（承認・拒否は本人が選ぶ）
 * - 同じ人から Follow が来直したら（相手の記録が外れた・送り直し）、今の状態で答え直す
 * - 新しいつながりを受けないサーバー（limit）・知らないユーザー宛て・承認待ちが多すぎる・ブロックした人からは Reject
 * - フォロワーを外すときも Reject{Follow}（Mastodon の「フォロワーから削除」と同じ。相手はフォローを外す）
 * - Accept・Reject には受けた Follow をそのまま埋め込む（相手は自分の Follow と突き合わせる）
 * - 読んでから書くまでは 2 人ごとにロックし、送る activity は書き込みと同じトランザクションで送る予定に入れる
 * - 取り下げた Follow の id は 14 日覚える（Undo が先に処理されても、遅れて届いた Follow でフォローに戻さない）
 */
import type { FollowerRecord, FollowerWriter } from '@ubichill/db';
import {
    type ActivityRef,
    acceptsNewContact,
    buildResponse,
    type DomainPolicy,
    FEDERATION_LIMITS,
    FEDIVERSE_LIMITS,
    type FediverseSettings,
} from '@ubichill/shared';
import type { FederationIdentity } from './identity';
import type { Outbox } from './outbox';

export interface FollowActor {
    id: string;
    inbox: string;
    domain: string;
}

export interface FollowDeps {
    identity: FederationIdentity;
    repo: {
        locked<T>(
            userId: string,
            actorId: string,
            fn: (current: FollowerRecord | undefined, write: FollowerWriter) => Promise<T>,
        ): Promise<T>;
        findByFollowId(followId: string): Promise<FollowerRecord[]>;
        pendingActorIdsOf(userId: string): Promise<string[]>;
        removeAllFor(actorId: string): Promise<FollowerRecord[]>;
    };
    /** このサーバーのユーザーがいるか（Application actor・消えたユーザーは false） */
    userExists(userId: string): Promise<boolean>;
    /** 2 人のどちらかがブロックしているか */
    blocked(userId: string, actorId: string): Promise<boolean>;
    settingsOf(userId: string): Promise<FediverseSettings>;
    /** 承認待ちをまとめて承認するとき、actor の inbox を引く */
    actorOf(actorId: string): Promise<FollowActor | null>;
    outbox: Pick<Outbox, 'prepare'>;
    notify: {
        fediverseFollowed(actorUri: string, userId: string): Promise<unknown>;
        fediverseFollowRequested(actorUri: string, userId: string): Promise<unknown>;
        /** 承認待ちの知らせを片付ける（承認した・拒否した・相手が取り下げた） */
        fediverseFollowSettled(userId: string, actorUri: string): Promise<unknown>;
    };
    seen: {
        remember(key: string, expiresAt: Date, now: Date): Promise<boolean>;
        has(key: string, now: Date): Promise<boolean>;
    };
    policyOf(domain: string): DomainPolicy;
    now(): number;
}

/** 受けた Follow を、Accept・Reject に埋め込む形にする。 */
const followRef = (followId: string, follower: string, followee: string): ActivityRef => ({
    id: followId,
    type: 'Follow',
    actor: follower,
    object: followee,
});

export type FollowerAction = 'approved' | 'rejected' | 'absent';

export function createFollows(deps: FollowDeps) {
    const now = () => new Date(deps.now());
    const actorUrl = (userId: string) => deps.identity.actorUrl(userId);

    /** 2 人のフォローをロックして fn を実行する。通知は確定してから出す。 */
    const withPair = async <T>(
        userId: string,
        actor: Pick<FollowActor, 'id' | 'inbox'>,
        fn: (
            row: FollowerRecord | undefined,
            pair: Pick<FollowerWriter, 'put' | 'remove' | 'countPending'> & {
                answer(type: 'Accept' | 'Reject', followId: string): Promise<void>;
                later(effect: () => Promise<unknown>): void;
            },
        ) => Promise<T>,
    ): Promise<T> => {
        const afterCommit: Array<() => Promise<unknown>> = [];
        const result = await deps.repo.locked(userId, actor.id, (row, write) =>
            fn(row, {
                put: write.put,
                remove: write.remove,
                countPending: write.countPending,
                async answer(type, followId) {
                    const delivery = deps.outbox.prepare({
                        activity: buildResponse(type, {
                            id: deps.identity.newActivityId(),
                            actor: actorUrl(userId),
                            to: actor.id,
                            object: followRef(followId, actor.id, actorUrl(userId)),
                        }),
                        from: { kind: 'user', userId },
                        to: { id: actor.id, inbox: actor.inbox },
                    });
                    if (delivery) await write.enqueue(delivery, now());
                },
                later: (effect) => void afterCommit.push(effect),
            }),
        );
        for (const effect of afterCommit) await effect();
        return result;
    };

    /** 承認待ちを承認する（ロックの中）。 */
    const approvePending = async (userId: string, actor: Pick<FollowActor, 'id' | 'inbox'>): Promise<boolean> =>
        withPair(userId, actor, async (row, pair) => {
            if (row?.state !== 'pending') return false;
            await pair.put({ state: 'accepted', followId: row.followId }, now());
            await pair.answer('Accept', row.followId);
            pair.later(() => deps.notify.fediverseFollowSettled(userId, actor.id));
            return true;
        });

    return {
        /** Follow を受けた。 */
        async onFollow(actor: FollowActor, activity: { id: string; object: string }): Promise<void> {
            const userId = deps.identity.localUserIdOf(activity.object);
            if (!userId || !(await deps.userExists(userId))) return;
            if (await deps.seen.has(`undone-follow|${activity.id}`, now())) return;
            const settings = await deps.settingsOf(userId);
            const welcome = acceptsNewContact(deps.policyOf(actor.domain));
            const blocked = await deps.blocked(userId, actor.id);
            await withPair(userId, actor, async (row, pair) => {
                // ブロックしたときに外したフォロワーの行が、行き違いで残っていても消す
                if (blocked) {
                    if (row) await pair.remove();
                    await pair.answer('Reject', activity.id);
                    if (row?.state === 'pending')
                        pair.later(() => deps.notify.fediverseFollowSettled(userId, actor.id));
                    return;
                }
                // すでにフォロワー: 相手が覚えていないだけなので、答え直す（新しい Follow の id で）
                if (row?.state === 'accepted') {
                    await pair.put({ state: 'accepted', followId: activity.id }, now());
                    await pair.answer('Accept', activity.id);
                    return;
                }
                if (row?.state === 'pending') {
                    await pair.put({ state: 'pending', followId: activity.id }, now());
                    return;
                }
                if (!welcome) {
                    await pair.answer('Reject', activity.id);
                    return;
                }
                if (!settings.manuallyApprovesFollowers) {
                    await pair.put({ state: 'accepted', followId: activity.id }, now());
                    await pair.answer('Accept', activity.id);
                    pair.later(() => deps.notify.fediverseFollowed(actor.id, userId));
                    return;
                }
                if ((await pair.countPending()) >= FEDIVERSE_LIMITS.MAX_PENDING_FOLLOWS) {
                    await pair.answer('Reject', activity.id);
                    return;
                }
                await pair.put({ state: 'pending', followId: activity.id }, now());
                pair.later(() => deps.notify.fediverseFollowRequested(actor.id, userId));
            });
        },

        /**
         * Undo を受けた。フォローの取り下げなら true（フレンドの Undo ではない）。object は Follow の id か、
         * 埋め込まれた Follow（id が分からない実装のために、相手と宛先の組でも引く）。
         */
        async onUndo(actor: Pick<FollowActor, 'id' | 'inbox'>, object: ActivityRef): Promise<boolean> {
            if (object.type === 'Follow') {
                await deps.seen.remember(
                    `undone-follow|${object.id}`,
                    new Date(now().getTime() + FEDERATION_LIMITS.UNDONE_MS),
                    now(),
                );
            }
            const byId = (await deps.repo.findByFollowId(object.id)).filter((r) => r.actorId === actor.id);
            const fallback =
                byId.length === 0 && object.type === 'Follow' && object.object
                    ? deps.identity.localUserIdOf(object.object)
                    : null;
            const userIds = fallback ? [fallback] : [...new Set(byId.map((r) => r.userId))];
            for (const userId of userIds) {
                await withPair(userId, actor, async (row, pair) => {
                    // 間に来直した Follow は消さない（遅れて届いた前の Follow の Undo）
                    if (!row || (!fallback && row.followId !== object.id)) return;
                    await pair.remove();
                    if (row.state === 'pending') pair.later(() => deps.notify.fediverseFollowSettled(userId, actor.id));
                });
            }
            return userIds.length > 0 || object.type === 'Follow';
        },

        /** 承認待ちを承認する。 */
        approve: (userId: string, actor: Pick<FollowActor, 'id' | 'inbox'>): Promise<boolean> =>
            approvePending(userId, actor),

        /** 承認待ちを断る・フォロワーから外す（どちらも Reject{Follow}）。 */
        async reject(userId: string, actor: Pick<FollowActor, 'id' | 'inbox'>): Promise<FollowerAction> {
            return withPair(userId, actor, async (row, pair): Promise<FollowerAction> => {
                if (!row) return 'absent';
                await pair.remove();
                await pair.answer('Reject', row.followId);
                if (row.state === 'pending') pair.later(() => deps.notify.fediverseFollowSettled(userId, actor.id));
                return 'rejected';
            });
        },

        /** 承認制をやめたら、承認待ちをまとめて承認する（Mastodon と同じ）。承認した数を返す。 */
        async settingsChanged(userId: string, before: FediverseSettings, after: FediverseSettings): Promise<number> {
            if (!before.manuallyApprovesFollowers || after.manuallyApprovesFollowers) return 0;
            const pending = await deps.repo.pendingActorIdsOf(userId);
            const results = await Promise.all(
                pending.map(async (actorId) => {
                    const actor = await deps.actorOf(actorId);
                    return actor ? approvePending(userId, actor) : false;
                }),
            );
            return results.filter(Boolean).length;
        },

        /** actor が消えた。フォローを消し、承認待ちの知らせを片付ける。 */
        async onActorDeleted(actorId: string): Promise<void> {
            const removed = await deps.repo.removeAllFor(actorId);
            await Promise.all(
                removed
                    .filter((r) => r.state === 'pending')
                    .map((r) => deps.notify.fediverseFollowSettled(r.userId, actorId)),
            );
        },
    };
}

export type Follows = ReturnType<typeof createFollows>;
