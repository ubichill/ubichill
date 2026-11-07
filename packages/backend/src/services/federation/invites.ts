/**
 * 招待とリクエストインバイトの連合。招待で入れる権利は、いつも部屋のサーバーが持つ。
 *
 * 送る:
 * - このサーバーの部屋から、ほかのサーバーのフレンドへ: 権利はこのサーバーの instance_invites に作り、Invite を相手の inbox へ届ける
 * - 来訪中のほかのサーバーの部屋から: 部屋のサーバーに権利を作ってもらい（grants）、このサーバーの人には通知、
 *   ほかのサーバーの人には Invite を届ける
 * - ほかのサーバーのフレンドへのリクエストインバイト: RequestInvite を届ける（同じ相手へは期限内に 1 度）
 *
 * 受ける（フレンドからだけ。知らない人の招待・リクエストは捨てる）:
 * - Invite: 通知にする（権利は部屋のサーバーが持つので、ここでは覚えない）
 * - RequestInvite: リクエストとして覚えて通知する（答えるときは、今いる部屋へ招待する）
 */
import {
    buildInvite,
    buildRequestInvite,
    INVITE_LIMITS,
    type InviteRefusal,
    type InviteRequestRefusal,
    isRemoteUserId,
    parseFederationUrl,
    type RoomCard,
    type SendInviteResult,
} from '@ubichill/shared';
import type { ActorDirectory } from './actors';
import type { FederationIdentity } from './identity';
import type { Outbox } from './outbox';
import type { Travel } from './travel';

export interface FederatedInvitesDeps {
    identity: FederationIdentity;
    allowHttp: boolean;
    actors: Pick<ActorDirectory, 'get'>;
    outbox: Pick<Outbox, 'send'>;
    travel: Pick<Travel, 'grant'>;
    /** このサーバーの部屋の作り（招待に載せる） */
    roomCard(instanceId: string): Promise<RoomCard | undefined>;
    isFriend(userId: string, actorId: string): Promise<boolean>;
    friendIdsOf(userId: string): Promise<ReadonlySet<string>>;
    visitOf(userId: string): Promise<{ roomUrl: string; room: RoomCard } | undefined>;
    userExists(userId: string): Promise<boolean>;
    requests: {
        createRequest(
            input: { requesterId: string; targetId: string; expiresAt: Date; activityId?: string | null },
            now: Date,
        ): Promise<'created' | 'exists'>;
        removeRequest(requesterId: string, targetId: string): Promise<boolean>;
    };
    notify: {
        remoteInvited(input: {
            from: { userId: string } | { actorUri: string };
            inviteeId: string;
            room: { address: string; url: string; name: string; image: string | null };
            message: string | null;
            expiresAt: Date;
        }): Promise<unknown>;
        remoteInviteRequested(input: { actorUri: string; targetId: string; expiresAt: Date }): Promise<unknown>;
    };
    now(): number;
}

const REFUSALS: readonly InviteRefusal[] = ['self', 'not-inside', 'not-friend', 'already-inside', 'needs-leader'];
const refusalOf = (reason: string | undefined): InviteRefusal => REFUSALS.find((r) => r === reason) ?? 'unavailable';

export function createFederatedInvites(deps: FederatedInvitesDeps) {
    const now = () => new Date(deps.now());
    const actorUrlOf = (id: string) => (isRemoteUserId(id) ? id : deps.identity.actorUrl(id));

    /** 部屋の見た目を通知の形にする（住所はこのサーバーの部屋なら ID、ほかは `<ID>@<ドメイン>`）。 */
    const noticeRoom = (room: Pick<RoomCard, 'id' | 'name' | 'image'>) => {
        const address = deps.identity.roomAddressOf(room.id);
        return address ? { address, url: room.id, name: room.name, image: room.image } : null;
    };

    /** ほかのサーバーの人へ Invite を届ける（送る人の鍵で署名）。相手を引けなければ false。 */
    const deliver = async (input: {
        inviterId: string;
        inviteeId: string;
        room: RoomCard;
        message: string | null;
        expiresAt: Date;
    }): Promise<boolean> => {
        const actor = await deps.actors.get(input.inviteeId);
        if (!actor || actor.deletedAt) return false;
        await deps.outbox.send({
            activity: buildInvite({
                id: deps.identity.newActivityId(),
                actor: deps.identity.actorUrl(input.inviterId),
                target: actor.id,
                room: input.room,
                content: input.message,
                endTime: input.expiresAt.toISOString(),
            }),
            from: { kind: 'user', userId: input.inviterId },
            to: { id: actor.id, inbox: actor.inbox },
            endTime: input.expiresAt,
        });
        return true;
    };

    return {
        /** このサーバーの部屋への招待を、ほかのサーバーの人へ届ける（権利は作ってある）。 */
        async deliverInvite(input: {
            inviterId: string;
            inviteeId: string;
            instanceId: string;
            message: string | null;
            expiresAt: Date;
        }): Promise<boolean> {
            const room = await deps.roomCard(input.instanceId);
            return !!room && deliver({ ...input, room });
        },

        /** 来訪中のほかのサーバーの部屋の住所（`<ID>@<ドメイン>`）。 */
        async visitingRoom(userId: string): Promise<string | undefined> {
            const visit = await deps.visitOf(userId);
            return (visit && deps.identity.roomAddressOf(visit.roomUrl)) ?? undefined;
        },

        /**
         * 来訪中のほかのサーバーの部屋（住所）へ招待する。その部屋にいない（来訪の記録が無い・別の部屋）なら null。
         * フレンドかはここで確かめ、部屋の規則（作成者のフレンドか・もう中にいるか）は部屋のサーバーが確かめる。
         */
        async sendFromRemoteRoom(
            inviterId: string,
            roomAddress: string,
            inviteeIds: readonly string[],
            message: string | null,
        ): Promise<SendInviteResult[] | null> {
            const visit = await deps.visitOf(inviterId);
            if (!visit || deps.identity.roomAddressOf(visit.roomUrl) !== roomAddress) return null;
            const roomUrl = visit.roomUrl;
            const friends = await deps.friendIdsOf(inviterId);
            const unique = [...new Set(inviteeIds)];
            const refusals = new Map(
                unique.flatMap(
                    (id): Array<[string, InviteRefusal]> =>
                        id === inviterId ? [[id, 'self']] : friends.has(id) ? [] : [[id, 'not-friend']],
                ),
            );
            const asked = unique.filter((id) => !refusals.has(id));
            const endTime = new Date(deps.now() + INVITE_LIMITS.INVITE_TTL_MS);
            const granted =
                asked.length > 0
                    ? await deps.travel.grant(inviterId, roomUrl, {
                          inviteId: deps.identity.newActivityId(),
                          invitees: asked.map(actorUrlOf),
                          endTime,
                      })
                    : null;
            const room = granted?.room?.id === roomUrl ? granted.room : visit.room;
            const notice = noticeRoom(room);
            const results: SendInviteResult[] = [];
            for (const id of unique) {
                const refused = refusals.get(id);
                if (refused) {
                    results.push({ userId: id, ok: false, reason: refused });
                    continue;
                }
                const answer = granted?.results.find((r) => r.invitee === actorUrlOf(id));
                if (!answer?.granted || !notice) {
                    results.push({ userId: id, ok: false, reason: answer ? refusalOf(answer.reason) : 'unavailable' });
                    continue;
                }
                const expiresAt = new Date(
                    Math.min(Date.parse(answer.expiresAt ?? '') || endTime.getTime(), endTime.getTime()),
                );
                if (isRemoteUserId(id)) {
                    const sent = await deliver({ inviterId, inviteeId: id, room, message, expiresAt });
                    results.push(sent ? { userId: id, ok: true } : { userId: id, ok: false, reason: 'unavailable' });
                } else {
                    await deps.notify.remoteInvited({
                        from: { userId: inviterId },
                        inviteeId: id,
                        room: notice,
                        message,
                        expiresAt,
                    });
                    results.push({ userId: id, ok: true });
                }
            }
            return results;
        },

        /** ほかのサーバーのフレンドに「あなたのいる部屋に入れて」と頼む。 */
        async requestRemote(
            requesterId: string,
            targetId: string,
        ): Promise<{ ok: true; alreadyRequested: boolean } | { ok: false; reason: InviteRequestRefusal }> {
            if (!(await deps.isFriend(requesterId, targetId))) return { ok: false, reason: 'not-friend' };
            const actor = await deps.actors.get(targetId);
            if (!actor || actor.deletedAt) return { ok: false, reason: 'offline' };
            const expiresAt = new Date(deps.now() + INVITE_LIMITS.REQUEST_TTL_MS);
            if ((await deps.requests.createRequest({ requesterId, targetId, expiresAt }, now())) === 'exists') {
                return { ok: true, alreadyRequested: true };
            }
            await deps.outbox.send({
                activity: buildRequestInvite({
                    id: deps.identity.newActivityId(),
                    actor: deps.identity.actorUrl(requesterId),
                    target: actor.id,
                    content: null,
                    endTime: expiresAt.toISOString(),
                }),
                from: { kind: 'user', userId: requesterId },
                to: { id: actor.id, inbox: actor.inbox },
                endTime: expiresAt,
            });
            return { ok: true, alreadyRequested: false };
        },

        // ── 受ける（署名と activity.actor を確かめたあと） ──

        async onInvite(
            actor: { id: string },
            activity: {
                target: string;
                room: { id: string; name: string; image: string | null };
                content: string | null;
                endTime: string;
            },
        ): Promise<void> {
            const inviteeId = deps.identity.localUserIdOf(activity.target);
            if (!inviteeId || !(await deps.userExists(inviteeId))) return;
            if (!(await deps.isFriend(inviteeId, actor.id))) return;
            const roomUrl = parseFederationUrl(activity.room.id, { allowHttp: deps.allowHttp });
            const image = activity.room.image && parseFederationUrl(activity.room.image, { allowHttp: deps.allowHttp });
            const notice =
                roomUrl && noticeRoom({ id: roomUrl.href, name: activity.room.name, image: image ? image.href : null });
            if (!notice) return;
            const expiresAt = Math.min(Date.parse(activity.endTime), deps.now() + INVITE_LIMITS.INVITE_TTL_MS);
            if (!(expiresAt > deps.now())) return;
            await deps.notify.remoteInvited({
                from: { actorUri: actor.id },
                inviteeId,
                room: notice,
                message: activity.content,
                expiresAt: new Date(expiresAt),
            });
            // こちらから頼んでいたなら、答えをもらったので次また頼めるようにする
            await deps.requests.removeRequest(inviteeId, actor.id);
        },

        async onRequestInvite(
            actor: { id: string },
            activity: { id: string; target: string; endTime: string },
        ): Promise<void> {
            const targetId = deps.identity.localUserIdOf(activity.target);
            if (!targetId || !(await deps.userExists(targetId))) return;
            if (!(await deps.isFriend(targetId, actor.id))) return;
            const expiresAt = Math.min(Date.parse(activity.endTime), deps.now() + INVITE_LIMITS.REQUEST_TTL_MS);
            if (!(expiresAt > deps.now())) return;
            const created = await deps.requests.createRequest(
                { requesterId: actor.id, targetId, expiresAt: new Date(expiresAt), activityId: activity.id },
                now(),
            );
            if (created === 'created') {
                await deps.notify.remoteInviteRequested({
                    actorUri: actor.id,
                    targetId,
                    expiresAt: new Date(expiresAt),
                });
            }
        },
    };
}

export type FederatedInvites = ReturnType<typeof createFederatedInvites>;
