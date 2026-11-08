/**
 * ほかのサーバーの人とのフレンド（Offer{Relationship friendOf} → Accept / Reject / Undo）。
 *
 * - お互いに申請したらフレンド（今のフレンドと同じ。双方が相手の Offer を自動で Accept する）
 * - Accept・Reject は「自分が出した Offer を、その相手から」だけ受ける（偽の承認を受けない）
 * - 断ったら 7 日は同じ相手からの申請を受けない。受けた申請は 1 人 100 件まで（失効は 30 日）
 * - 取り消し（Undo）した Offer の id は 14 日覚え、遅れて届いた申請を無視する
 * - お互いに申請したときは、相手の Offer の id も持つ（双方が自分の Offer の Undo で解除するので、どちらからでも消せる）
 * - 送るのは相手の個人の inbox（送り手のユーザーの鍵で署名）
 * - 読んでから書くまでは 2 人の関係ごとにロックする（同時の申請・承認・解除で片方が消えないように。送る順も揃う）
 */
import type { RemoteFriendshipRecord, RemoteFriendshipWriter } from '@ubichill/db';
import {
    type ActivityRef,
    acceptsNewContact,
    buildFriendOffer,
    buildResponse,
    type DomainPolicy,
    FEDERATION_LIMITS,
    sameOrigin,
} from '@ubichill/shared';
import type { FederationIdentity } from './identity';
import type { Outbox } from './outbox';

export interface FriendshipActor {
    id: string;
    inbox: string;
    domain: string;
    deletedAt: Date | null;
}

export interface FriendshipDeps {
    identity: FederationIdentity;
    repo: {
        /** 2 人の関係をロックして、今の行を読んで fn を実行する（fn が投げたら書き込みは戻る） */
        locked<T>(
            userId: string,
            actorId: string,
            fn: (current: RemoteFriendshipRecord | undefined, write: RemoteFriendshipWriter) => Promise<T>,
        ): Promise<T>;
        removeAllFor(actorId: string): Promise<RemoteFriendshipRecord[]>;
        /** 申請の Offer か、相手の Offer（peerOfferId）がその id の関係 */
        findByOffer(offerId: string): Promise<RemoteFriendshipRecord[]>;
        findByAccept(acceptId: string): Promise<RemoteFriendshipRecord[]>;
        countIncoming(userId: string): Promise<number>;
    };
    userExists(userId: string): Promise<boolean>;
    outbox: Pick<Outbox, 'send'>;
    notify: {
        remoteFriendRequested(actorUri: string, userId: string): Promise<unknown>;
        remoteFriendAccepted(actorUri: string, userId: string): Promise<unknown>;
        remoteFriendshipConfirmed(userId: string, actorUri: string): Promise<unknown>;
        remoteFriendshipRemoved(userId: string, actorUri: string): Promise<unknown>;
    };
    seen: {
        remember(key: string, expiresAt: Date, now: Date): Promise<boolean>;
        has(key: string, now: Date): Promise<boolean>;
    };
    policyOf(domain: string): DomainPolicy;
    now(): number;
}

/** 画面から見た関係（このサーバーのフレンドと同じ語）。 */
export type FriendshipView = 'none' | 'friends' | 'outgoing' | 'incoming';

export const friendshipViewOf = (row: Pick<RemoteFriendshipRecord, 'state'> | undefined): FriendshipView =>
    !row || row.state === 'rejected' ? 'none' : row.state === 'accepted' ? 'friends' : row.state;

export type RequestOutcome =
    | { ok: true; friendship: FriendshipView }
    | { ok: false; reason: 'domain-limited' | 'gone' };

export function createRemoteFriendships(deps: FriendshipDeps) {
    const now = () => new Date(deps.now());
    const actorOf = (userId: string) => deps.identity.actorUrl(userId);

    const send = (
        userId: string,
        actor: Pick<FriendshipActor, 'id' | 'inbox'>,
        activity: Record<string, unknown> & { id: string },
    ) => deps.outbox.send({ activity, from: { kind: 'user', userId }, to: { id: actor.id, inbox: actor.inbox } });

    /** こちらから相手の申請を承認して、フレンドにする。 */
    const acceptIncoming = async (
        userId: string,
        actor: Pick<FriendshipActor, 'id' | 'inbox'>,
        row: RemoteFriendshipRecord,
        write: RemoteFriendshipWriter,
    ) => {
        const acceptId = deps.identity.newActivityId();
        await write.put({ ...row, state: 'accepted', acceptId }, now());
        await send(
            userId,
            actor,
            buildResponse('Accept', {
                id: acceptId,
                actor: actorOf(userId),
                to: actor.id,
                object: { id: row.offerId, type: 'Offer', actor: actor.id },
            }),
        );
        await deps.notify.remoteFriendshipConfirmed(userId, actor.id);
    };

    /** その Offer を出した、このサーバーのユーザー（ロックの前の当たり。ロックの中で isOurPendingOffer を確かめ直す） */
    const usersWithOurOffer = async (actor: Pick<FriendshipActor, 'id'>, offerId: string) => {
        const rows = await deps.repo.findByOffer(offerId);
        return [...new Set(rows.filter((r) => r.actorId === actor.id).map((r) => r.userId))];
    };
    const isOurPendingOffer = (
        row: RemoteFriendshipRecord | undefined,
        offerId: string,
    ): row is RemoteFriendshipRecord =>
        row?.state === 'outgoing' && row.offerId === offerId && sameOrigin(row.offerId, deps.identity.origin);

    return {
        /** 申請する。相手から申請が来ていれば承認になる（お互いに申請したらフレンド）。 */
        async request(userId: string, actor: FriendshipActor): Promise<RequestOutcome> {
            if (actor.deletedAt) return { ok: false, reason: 'gone' };
            if (!acceptsNewContact(deps.policyOf(actor.domain))) return { ok: false, reason: 'domain-limited' };
            return deps.repo.locked(userId, actor.id, async (row, write): Promise<RequestOutcome> => {
                if (row?.state === 'accepted') return { ok: true, friendship: 'friends' };
                if (row?.state === 'outgoing') return { ok: true, friendship: 'outgoing' };
                if (row?.state === 'incoming') {
                    await acceptIncoming(userId, actor, row, write);
                    return { ok: true, friendship: 'friends' };
                }
                const offerId = deps.identity.newActivityId();
                const relationshipId = deps.identity.newRelationshipId();
                await write.put({ state: 'outgoing', offerId, relationshipId }, now());
                await send(
                    userId,
                    actor,
                    buildFriendOffer({
                        id: offerId,
                        actor: actorOf(userId),
                        target: actor.id,
                        relationshipId,
                        published: now().toISOString(),
                    }),
                );
                return { ok: true, friendship: 'outgoing' };
            });
        },

        /** 受けた申請を承認する。 */
        async accept(userId: string, actor: FriendshipActor): Promise<boolean> {
            return deps.repo.locked(userId, actor.id, async (row, write) => {
                if (row?.state !== 'incoming') return false;
                await acceptIncoming(userId, actor, row, write);
                return true;
            });
        },

        /**
         * 関係を消す（受けた申請を断る・こちらの申請を取り消す・フレンドを解除する）。
         * 断ったら冷却期間の印を残す。取り消し・解除は、申請した側は Undo{Offer}、承認した側は Undo{Accept}。
         */
        async remove(userId: string, actor: Pick<FriendshipActor, 'id' | 'inbox'>): Promise<boolean> {
            return deps.repo.locked(userId, actor.id, async (row, write) => {
                if (!row) return false;
                const me = actorOf(userId);
                if (row.state === 'incoming') {
                    await write.put({ ...row, state: 'rejected' }, now());
                    await send(
                        userId,
                        actor,
                        buildResponse('Reject', {
                            id: deps.identity.newActivityId(),
                            actor: me,
                            to: actor.id,
                            object: { id: row.offerId, type: 'Offer', actor: actor.id },
                        }),
                    );
                } else {
                    await write.remove();
                    if (row.state !== 'rejected') {
                        const ours = sameOrigin(row.offerId, deps.identity.origin);
                        const object: ActivityRef = ours
                            ? { id: row.offerId, type: 'Offer', actor: me }
                            : { id: row.acceptId ?? row.offerId, type: row.acceptId ? 'Accept' : 'Offer', actor: me };
                        await send(
                            userId,
                            actor,
                            buildResponse('Undo', {
                                id: deps.identity.newActivityId(),
                                actor: me,
                                to: actor.id,
                                object,
                            }),
                        );
                    }
                }
                await deps.notify.remoteFriendshipRemoved(userId, actor.id);
                return true;
            });
        },

        // ── 受ける（署名を確かめ、activity.actor = 署名した actor を確かめたあと） ──

        async onOffer(actor: FriendshipActor, activity: { id: string; target: string; relationshipId: string }) {
            const userId = deps.identity.localUserIdOf(activity.target);
            if (!userId || !(await deps.userExists(userId))) return;
            await deps.repo.locked(userId, actor.id, async (row, write) => {
                if (await deps.seen.has(`undone|${activity.id}`, now())) return;
                if (row?.state === 'accepted') {
                    // もうフレンド（承認が届いていなかった）。承認を送り直す
                    await send(
                        userId,
                        actor,
                        buildResponse('Accept', {
                            id: row.acceptId ?? deps.identity.newActivityId(),
                            actor: actorOf(userId),
                            to: actor.id,
                            object: { id: activity.id, type: 'Offer', actor: actor.id },
                        }),
                    );
                    return;
                }
                if (!acceptsNewContact(deps.policyOf(actor.domain))) return;
                if (row?.state === 'outgoing') {
                    // お互いに申請した: 相手の申請を承認してフレンドにする。相手は自分の Offer の Undo で解除してくるので、その id も持つ
                    const acceptId = deps.identity.newActivityId();
                    await write.put({ ...row, state: 'accepted', acceptId, peerOfferId: activity.id }, now());
                    await send(
                        userId,
                        actor,
                        buildResponse('Accept', {
                            id: acceptId,
                            actor: actorOf(userId),
                            to: actor.id,
                            object: { id: activity.id, type: 'Offer', actor: actor.id },
                        }),
                    );
                    await deps.notify.remoteFriendAccepted(actor.id, userId);
                    return;
                }
                if (
                    row?.state === 'rejected' &&
                    now().getTime() - row.updatedAt.getTime() < FEDERATION_LIMITS.REJECT_COOLDOWN_MS
                ) {
                    return;
                }
                if (row?.state === 'incoming') {
                    await write.put({ ...row, offerId: activity.id, relationshipId: activity.relationshipId }, now());
                    return;
                }
                if ((await deps.repo.countIncoming(userId)) >= FEDERATION_LIMITS.MAX_PENDING_FRIEND_REQUESTS) return;
                await write.put(
                    { state: 'incoming', offerId: activity.id, relationshipId: activity.relationshipId },
                    now(),
                );
                await deps.notify.remoteFriendRequested(actor.id, userId);
            });
        },

        /** 承認: 自分が出した Offer を、その相手が承認したものだけ。 */
        async onAccept(actor: FriendshipActor, activity: { id: string; object: ActivityRef }) {
            for (const userId of await usersWithOurOffer(actor, activity.object.id)) {
                await deps.repo.locked(userId, actor.id, async (row, write) => {
                    if (!isOurPendingOffer(row, activity.object.id)) return;
                    await write.put({ ...row, state: 'accepted', acceptId: activity.id }, now());
                    await deps.notify.remoteFriendAccepted(actor.id, userId);
                });
            }
        },

        /** 断られた: 自分が出した Offer を、その相手が断ったものだけ。 */
        async onReject(actor: FriendshipActor, activity: { object: ActivityRef }) {
            for (const userId of await usersWithOurOffer(actor, activity.object.id)) {
                await deps.repo.locked(userId, actor.id, async (row, write) => {
                    if (isOurPendingOffer(row, activity.object.id)) await write.remove();
                });
            }
        },

        /** 取り消し・解除: 相手が出した Offer（申請の取り消し・解除）か、相手が出した Accept（解除）。 */
        async onUndo(actor: FriendshipActor, activity: { object: ActivityRef }) {
            const objectId = activity.object.id;
            if (!sameOrigin(objectId, actor.id)) return;
            await deps.seen.remember(
                `undone|${objectId}`,
                new Date(now().getTime() + FEDERATION_LIMITS.UNDONE_MS),
                now(),
            );
            const rows = [...(await deps.repo.findByOffer(objectId)), ...(await deps.repo.findByAccept(objectId))];
            const userIds = new Set(rows.filter((r) => r.actorId === actor.id).map((r) => r.userId));
            for (const userId of userIds) {
                await deps.repo.locked(userId, actor.id, async (row, write) => {
                    if (!row || ![row.offerId, row.peerOfferId, row.acceptId].includes(objectId)) return;
                    await write.remove();
                    await deps.notify.remoteFriendshipRemoved(userId, actor.id);
                });
            }
        },

        /** actor が消えた: 関係をすべて消す。 */
        async onActorDeleted(actorId: string) {
            for (const row of await deps.repo.removeAllFor(actorId)) {
                await deps.notify.remoteFriendshipRemoved(row.userId, actorId);
            }
        },
    };
}

export type RemoteFriendships = ReturnType<typeof createRemoteFriendships>;
