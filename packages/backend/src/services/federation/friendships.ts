/**
 * ほかのサーバーの人とのフレンド（Offer{Relationship friendOf} → Accept / Reject / Undo）。
 *
 * - お互いに申請したらフレンド（今のフレンドと同じ。双方が相手の Offer を自動で Accept する）
 * - Accept・Reject は「自分が出した Offer を、その相手から」だけ受ける（偽の承認を受けない）
 * - 断ったら 7 日は同じ相手からの申請を受けない。受けた申請は 1 人 100 件まで（失効は 30 日）
 * - 取り消し（Undo）した Offer の id は 14 日覚え、遅れて届いた申請を無視する
 * - 送るのは相手の個人の inbox（送り手のユーザーの鍵で署名）
 */
import type { RemoteFriendshipRecord, RemoteFriendshipState } from '@ubichill/db';
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
        get(userId: string, actorId: string): Promise<RemoteFriendshipRecord | undefined>;
        put(
            input: {
                userId: string;
                actorId: string;
                state: RemoteFriendshipState;
                offerId: string;
                relationshipId: string;
                acceptId?: string | null;
            },
            now: Date,
        ): Promise<RemoteFriendshipRecord>;
        remove(userId: string, actorId: string): Promise<RemoteFriendshipRecord | undefined>;
        removeAllFor(actorId: string): Promise<RemoteFriendshipRecord[]>;
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
    ) => {
        const acceptId = deps.identity.newActivityId();
        await deps.repo.put({ ...row, state: 'accepted', acceptId }, now());
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

    return {
        /** 申請する。相手から申請が来ていれば承認になる（お互いに申請したらフレンド）。 */
        async request(userId: string, actor: FriendshipActor): Promise<RequestOutcome> {
            if (actor.deletedAt) return { ok: false, reason: 'gone' };
            if (!acceptsNewContact(deps.policyOf(actor.domain))) return { ok: false, reason: 'domain-limited' };
            const row = await deps.repo.get(userId, actor.id);
            if (row?.state === 'accepted') return { ok: true, friendship: 'friends' };
            if (row?.state === 'outgoing') return { ok: true, friendship: 'outgoing' };
            if (row?.state === 'incoming') {
                await acceptIncoming(userId, actor, row);
                return { ok: true, friendship: 'friends' };
            }
            const offerId = deps.identity.newActivityId();
            const relationshipId = deps.identity.newRelationshipId();
            await deps.repo.put({ userId, actorId: actor.id, state: 'outgoing', offerId, relationshipId }, now());
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
        },

        /** 受けた申請を承認する。 */
        async accept(userId: string, actor: FriendshipActor): Promise<boolean> {
            const row = await deps.repo.get(userId, actor.id);
            if (row?.state !== 'incoming') return false;
            await acceptIncoming(userId, actor, row);
            return true;
        },

        /**
         * 関係を消す（受けた申請を断る・こちらの申請を取り消す・フレンドを解除する）。
         * 断ったら冷却期間の印を残す。取り消し・解除は、申請した側は Undo{Offer}、承認した側は Undo{Accept}。
         */
        async remove(userId: string, actor: Pick<FriendshipActor, 'id' | 'inbox'>): Promise<boolean> {
            const row = await deps.repo.get(userId, actor.id);
            if (!row) return false;
            const me = actorOf(userId);
            if (row.state === 'incoming') {
                await deps.repo.put({ ...row, state: 'rejected' }, now());
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
                await deps.repo.remove(userId, actor.id);
                if (row.state !== 'rejected') {
                    const ours = sameOrigin(row.offerId, deps.identity.origin);
                    const object: ActivityRef = ours
                        ? { id: row.offerId, type: 'Offer', actor: me }
                        : { id: row.acceptId ?? row.offerId, type: row.acceptId ? 'Accept' : 'Offer', actor: me };
                    await send(
                        userId,
                        actor,
                        buildResponse('Undo', { id: deps.identity.newActivityId(), actor: me, to: actor.id, object }),
                    );
                }
            }
            await deps.notify.remoteFriendshipRemoved(userId, actor.id);
            return true;
        },

        // ── 受ける（署名を確かめ、activity.actor = 署名した actor を確かめたあと） ──

        async onOffer(actor: FriendshipActor, activity: { id: string; target: string; relationshipId: string }) {
            const userId = deps.identity.localUserIdOf(activity.target);
            if (!userId || !(await deps.userExists(userId))) return;
            if (await deps.seen.has(`undone|${activity.id}`, now())) return;
            const row = await deps.repo.get(userId, actor.id);
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
                // お互いに申請した: 相手の申請を承認してフレンドにする
                const acceptId = deps.identity.newActivityId();
                await deps.repo.put({ ...row, state: 'accepted', acceptId }, now());
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
                await deps.repo.put({ ...row, offerId: activity.id, relationshipId: activity.relationshipId }, now());
                return;
            }
            if ((await deps.repo.countIncoming(userId)) >= FEDERATION_LIMITS.MAX_PENDING_FRIEND_REQUESTS) return;
            await deps.repo.put(
                {
                    userId,
                    actorId: actor.id,
                    state: 'incoming',
                    offerId: activity.id,
                    relationshipId: activity.relationshipId,
                },
                now(),
            );
            await deps.notify.remoteFriendRequested(actor.id, userId);
        },

        /** 承認: 自分が出した Offer を、その相手が承認したものだけ。 */
        async onAccept(actor: FriendshipActor, activity: { id: string; object: ActivityRef }) {
            const rows = await deps.repo.findByOffer(activity.object.id);
            const row = rows.find((r) => r.actorId === actor.id && r.state === 'outgoing');
            if (!row || !sameOrigin(row.offerId, deps.identity.origin)) return;
            await deps.repo.put({ ...row, state: 'accepted', acceptId: activity.id }, now());
            await deps.notify.remoteFriendAccepted(actor.id, row.userId);
        },

        /** 断られた: 自分が出した Offer を、その相手が断ったものだけ。 */
        async onReject(actor: FriendshipActor, activity: { object: ActivityRef }) {
            const rows = await deps.repo.findByOffer(activity.object.id);
            const row = rows.find((r) => r.actorId === actor.id && r.state === 'outgoing');
            if (!row || !sameOrigin(row.offerId, deps.identity.origin)) return;
            await deps.repo.remove(row.userId, actor.id);
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
            const rows = [
                ...(await deps.repo.findByOffer(objectId)),
                ...(await deps.repo.findByAccept(objectId)),
            ].filter((r) => r.actorId === actor.id);
            for (const row of rows) {
                await deps.repo.remove(row.userId, actor.id);
                await deps.notify.remoteFriendshipRemoved(row.userId, actor.id);
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
