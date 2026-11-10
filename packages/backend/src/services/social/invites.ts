/**
 * 招待とリクエストインバイト。送れるか・頼めるかは shared の instanceAccess.ts の規則で決め、ここは
 * 「いまどの部屋にいるか（Go の在室）」「誰がフレンドか」を集めて規則に渡し、保存と通知をする。DB・在室・通知は注入する。
 */
import {
    type AccessType,
    DEFAULT_PRESENCE_VISIBILITY,
    INVITE_LIMITS,
    type InstanceAudience,
    type InviteRefusal,
    type InviteRequestRefusal,
    inviteRefusal,
    inviteRequestRefusal,
    isRemoteUserId,
    type PresenceVisibility,
    type SendInviteResult,
} from '@ubichill/shared';

export interface InviteRoom {
    id: string;
    leaderId: string;
    accessType: AccessType;
    maxUsers: number;
}

export interface InviteServiceDeps {
    rooms: {
        find(instanceId: string): Promise<InviteRoom | undefined>;
        /** 通知に載せる部屋の見た目（ワールドの名前とサムネイル）。ワールドを開けなければ undefined */
        describe(instanceId: string): Promise<{ name: string; image: string | null } | undefined>;
    };
    /** Go の在室（部屋 ID → 参加している人） */
    presence(): Promise<ReadonlyMap<string, { memberIds: readonly string[] }>>;
    friendIdsOf(userId: string): Promise<ReadonlySet<string>>;
    /** このサーバーのユーザーのオンライン状態の見せ方（行が無ければ初期値で埋める） */
    visibilityOf(userIds: readonly string[]): Promise<ReadonlyMap<string, PresenceVisibility>>;
    invites: {
        upsert(input: {
            instanceId: string;
            inviterId: string;
            inviteeId: string;
            message: string | null;
            expiresAt: Date;
        }): Promise<unknown>;
        findValid(instanceId: string, inviteeId: string, now: Date): Promise<unknown | undefined>;
        createRequest(
            input: { requesterId: string; targetId: string; expiresAt: Date },
            now: Date,
        ): Promise<'created' | 'exists'>;
        hasRequest(requesterId: string, targetId: string, now: Date): Promise<boolean>;
        removeRequest(requesterId: string, targetId: string): Promise<boolean>;
    };
    notify: {
        invited(input: {
            inviterId: string;
            inviteeId: string;
            instance: { id: string; name: string; image: string | null };
            message: string | null;
            expiresAt: Date;
        }): Promise<unknown>;
        inviteRequested(input: { requesterId: string; targetId: string; expiresAt: Date }): Promise<unknown>;
        inviteRequestAnswered(targetId: string, requesterId: string): Promise<unknown>;
    };
    /** 連合（ほかのサーバーの部屋・ほかのサーバーの人）。無ければこのサーバーの中だけ */
    federation?: InviteFederation;
    now(): Date;
}

/** 招待の連合の口（federation/invites.ts）。ほかのサーバーの部屋は、画面の住所（`<ID>@<ドメイン>`）で指す。 */
export interface InviteFederation {
    /** ほかのサーバーの部屋の住所か */
    isRemoteRoom(roomRef: string): boolean;
    /** 来訪中のほかのサーバーの部屋の住所 */
    visitingRoom(userId: string): Promise<string | undefined>;
    /** ほかのサーバーの人で、そのサーバーが招待に対応していないと分かっているか */
    cannotReceiveInvites(userId: string): Promise<boolean>;
    /** このサーバーの部屋への招待を、ほかのサーバーの人へ届ける。届けられなければ false */
    deliverInvite(input: {
        inviterId: string;
        inviteeId: string;
        instanceId: string;
        message: string | null;
        expiresAt: Date;
    }): Promise<boolean>;
    /** 来訪中のほかのサーバーの部屋へ招待する。その部屋にいなければ null */
    sendFromRemoteRoom(
        inviterId: string,
        roomAddress: string,
        inviteeIds: readonly string[],
        message: string | null,
    ): Promise<SendInviteResult[] | null>;
    /** ほかのサーバーのフレンドにリクエストインバイトを送る */
    requestRemote(requesterId: string, targetId: string): Promise<RequestOutcome>;
}

export type SendInvitesOutcome = { ok: true; results: SendInviteResult[] } | { ok: false; error: 'not-found' };

export interface InviteCandidate {
    userId: string;
    /** 送れなければ理由 */
    refusal: InviteRefusal | null;
    /** どこかの部屋にいる（本人の見せ方に従う。見せない人・ほかのサーバーの人は false） */
    online: boolean;
}

export type RequestOutcome = { ok: true; alreadyRequested: boolean } | { ok: false; reason: InviteRequestRefusal };

export type AnswerOutcome = { ok: true } | { ok: false; reason: 'no-request' | 'offline' | InviteRefusal };

export function createInviteService(deps: InviteServiceDeps) {
    /** 部屋の公開範囲の判定に要る情報（在室は Go が真）。部屋が無ければ undefined。 */
    const audienceOf = async (
        instanceId: string,
        presence: ReadonlyMap<string, { memberIds: readonly string[] }>,
    ): Promise<InstanceAudience | undefined> => {
        const room = await deps.rooms.find(instanceId);
        if (!room) return undefined;
        return {
            accessType: room.accessType,
            leaderId: room.leaderId,
            memberIds: presence.get(room.id)?.memberIds ?? [],
            maxUsers: room.maxUsers,
        };
    };

    /**
     * 招待の画面に出す「オンライン」。見せない人は部屋にいても false。ほかのサーバーの人は本人の見せ方が分からないので false
     * （ここに来訪していても、ホームに確かめずに在室を出さない）。
     */
    const onlineFor = async (
        presence: ReadonlyMap<string, { memberIds: readonly string[] }>,
        userIds: readonly string[],
    ): Promise<(userId: string) => boolean> => {
        const visibility = await deps.visibilityOf(userIds.filter((id) => !isRemoteUserId(id)));
        return (userId) =>
            !isRemoteUserId(userId) &&
            (visibility.get(userId) ?? DEFAULT_PRESENCE_VISIBILITY) !== 'hidden' &&
            roomOf(presence, userId) !== undefined;
    };

    /** その人がいま入っている部屋の ID（1 アカウント 1 接続なので 1 つ）。 */
    const roomOf = (presence: ReadonlyMap<string, { memberIds: readonly string[] }>, userId: string) =>
        [...presence].find(([, room]) => room.memberIds.includes(userId))?.[0];

    /** 部屋の規則で送れない理由か、相手のサーバーが招待に対応していない（送る前に分かる） */
    const refusalFor = async (
        audience: InstanceAudience,
        inviterId: string,
        inviteeId: string,
        friends: { inviter: ReadonlySet<string>; leader: ReadonlySet<string> },
    ): Promise<InviteRefusal | null> =>
        inviteRefusal(audience, inviterId, inviteeId, friends) ??
        (isRemoteUserId(inviteeId) && (await deps.federation?.cannotReceiveInvites(inviteeId)) ? 'unsupported' : null);

    /** 送れる相手に招待を保存して通知する。送れない相手は理由を返す（ほかの相手には送る）。 */
    const sendOne = async (
        audience: InstanceAudience,
        instance: { id: string; name: string; image: string | null },
        inviterId: string,
        inviteeId: string,
        friends: { inviter: ReadonlySet<string>; leader: ReadonlySet<string> },
        message: string | null,
    ): Promise<SendInviteResult> => {
        const refusal = await refusalFor(audience, inviterId, inviteeId, friends);
        if (refusal) return { userId: inviteeId, ok: false, reason: refusal };
        const expiresAt = new Date(deps.now().getTime() + INVITE_LIMITS.INVITE_TTL_MS);
        await deps.invites.upsert({ instanceId: instance.id, inviterId, inviteeId, message, expiresAt });
        if (!isRemoteUserId(inviteeId)) {
            await deps.notify.invited({ inviterId, inviteeId, instance, message, expiresAt });
            return { userId: inviteeId, ok: true };
        }
        // ほかのサーバーの人: 権利はこのサーバーが持ち、知らせは相手のサーバーへ届ける
        const delivered = await deps.federation?.deliverInvite({
            inviterId,
            inviteeId,
            instanceId: instance.id,
            message,
            expiresAt,
        });
        return delivered ? { userId: inviteeId, ok: true } : { userId: inviteeId, ok: false, reason: 'unavailable' };
    };

    const friendsFor = async (audience: InstanceAudience, inviterId: string) => {
        const inviter = await deps.friendIdsOf(inviterId);
        const leader = audience.leaderId === inviterId ? inviter : await deps.friendIdsOf(audience.leaderId);
        return { inviter, leader };
    };

    /** inviterId が今いる部屋（このサーバーの部屋か、来訪中のほかのサーバーの部屋）へ 1 人招待する。どこにもいなければ undefined。 */
    const inviteToWhereIAm = async (inviterId: string, inviteeId: string): Promise<SendInviteResult | undefined> => {
        const presence = await deps.presence();
        const roomId = roomOf(presence, inviterId);
        if (!roomId) {
            const address = await deps.federation?.visitingRoom(inviterId);
            const results =
                address && (await deps.federation?.sendFromRemoteRoom(inviterId, address, [inviteeId], null));
            return results ? results[0] : undefined;
        }
        const audience = await audienceOf(roomId, presence);
        const look = audience ? await deps.rooms.describe(roomId) : undefined;
        if (!audience || !look) return undefined;
        return sendOne(
            audience,
            { id: roomId, ...look },
            inviterId,
            inviteeId,
            await friendsFor(audience, inviterId),
            null,
        );
    };

    return {
        /** inviterId が今いる部屋（このサーバーの部屋の ID か、ほかのサーバーの部屋の住所）に、相手を招待する。 */
        async sendInvites(
            inviterId: string,
            instanceId: string,
            inviteeIds: readonly string[],
            message: string | null,
        ): Promise<SendInvitesOutcome> {
            if (deps.federation?.isRemoteRoom(instanceId)) {
                const results = await deps.federation.sendFromRemoteRoom(
                    inviterId,
                    instanceId,
                    inviteeIds,
                    message || null,
                );
                return results ? { ok: true, results } : { ok: false, error: 'not-found' };
            }
            const presence = await deps.presence();
            const audience = await audienceOf(instanceId, presence);
            const look = audience ? await deps.rooms.describe(instanceId) : undefined;
            if (!audience || !look) return { ok: false, error: 'not-found' };
            const friends = await friendsFor(audience, inviterId);
            const instance = { id: instanceId, ...look };
            const results: SendInviteResult[] = [];
            for (const inviteeId of new Set(inviteeIds)) {
                results.push(await sendOne(audience, instance, inviterId, inviteeId, friends, message || null));
            }
            return { ok: true, results };
        },

        /** 招待の画面に出すフレンド（送れるか・どこかにいるか）。部屋が無ければ undefined。 */
        async candidates(inviterId: string, instanceId: string): Promise<InviteCandidate[] | undefined> {
            const presence = await deps.presence();
            if (deps.federation?.isRemoteRoom(instanceId)) {
                // ほかのサーバーの部屋の規則は部屋のサーバーが確かめる（送ってみるまで分からない）
                if ((await deps.federation.visitingRoom(inviterId)) !== instanceId) return undefined;
                const federated = deps.federation;
                const friendIds = [...(await deps.friendIdsOf(inviterId))];
                const online = await onlineFor(presence, friendIds);
                return Promise.all(
                    friendIds.map(async (userId) => ({
                        userId,
                        refusal:
                            isRemoteUserId(userId) && (await federated.cannotReceiveInvites(userId))
                                ? ('unsupported' as const)
                                : null,
                        online: online(userId),
                    })),
                );
            }
            const audience = await audienceOf(instanceId, presence);
            if (!audience) return undefined;
            const friends = await friendsFor(audience, inviterId);
            const online = await onlineFor(presence, [...friends.inviter]);
            return Promise.all(
                [...friends.inviter].map(async (userId) => ({
                    userId,
                    refusal: await refusalFor(audience, inviterId, userId, friends),
                    online: online(userId),
                })),
            );
        },

        /** requesterId が targetId に「あなたのいる部屋に入れて」と頼む。期限内のリクエストがあれば送り直さない。 */
        async requestInvite(requesterId: string, targetId: string): Promise<RequestOutcome> {
            if (isRemoteUserId(targetId)) {
                return deps.federation
                    ? deps.federation.requestRemote(requesterId, targetId)
                    : { ok: false, reason: 'not-friend' };
            }
            const now = deps.now();
            const [presence, requesterFriends, visibilities] = await Promise.all([
                deps.presence(),
                deps.friendIdsOf(requesterId),
                deps.visibilityOf([targetId]),
            ]);
            const visibility = visibilities.get(targetId) ?? DEFAULT_PRESENCE_VISIBILITY;
            const roomId = roomOf(presence, targetId);
            const audience = roomId ? await audienceOf(roomId, presence) : undefined;
            const visiting = !audience && (await deps.federation?.visitingRoom(targetId)) ? 'remote' : null;
            const refusal = inviteRequestRefusal(
                requesterId,
                targetId,
                requesterFriends,
                audience ?? visiting,
                visibility,
            );
            if (refusal) return { ok: false, reason: refusal };
            // もう招待をもらっているなら、頼まずに入ればよい（場所を見せている人のときだけ。断る理由で場所を漏らさない）
            if (
                visibility === 'location' &&
                roomId &&
                audience &&
                (await deps.invites.findValid(roomId, requesterId, now))
            ) {
                return { ok: false, reason: 'can-join' };
            }
            const expiresAt = new Date(now.getTime() + INVITE_LIMITS.REQUEST_TTL_MS);
            if ((await deps.invites.createRequest({ requesterId, targetId, expiresAt }, now)) === 'exists') {
                return { ok: true, alreadyRequested: true };
            }
            await deps.notify.inviteRequested({ requesterId, targetId, expiresAt });
            return { ok: true, alreadyRequested: false };
        },

        /**
         * targetId がリクエストに答える。招待するなら、いま自分がいる部屋へ招待する（送れる人の規則は招待と同じ）。
         * 送れなければリクエストは残す（部屋を作った人に頼む・別の部屋に移ってから答え直せる）。
         */
        async answerRequest(targetId: string, requesterId: string, accept: boolean): Promise<AnswerOutcome> {
            const now = deps.now();
            if (!(await deps.invites.hasRequest(requesterId, targetId, now))) {
                await deps.invites.removeRequest(requesterId, targetId);
                await deps.notify.inviteRequestAnswered(targetId, requesterId);
                return { ok: false, reason: 'no-request' };
            }
            if (accept) {
                const result = await inviteToWhereIAm(targetId, requesterId);
                if (!result) return { ok: false, reason: 'offline' };
                // もう同じ部屋にいるなら、招待しなくても済んでいる
                if (!result.ok && result.reason !== 'already-inside') return { ok: false, reason: result.reason };
            }
            await deps.invites.removeRequest(requesterId, targetId);
            await deps.notify.inviteRequestAnswered(targetId, requesterId);
            return { ok: true };
        },

        /** 期限内の招待があるか（入れるかの判定に使う）。 */
        async isInvited(instanceId: string, userId: string): Promise<boolean> {
            return (await deps.invites.findValid(instanceId, userId, deps.now())) !== undefined;
        },
    };
}

export type InviteService = ReturnType<typeof createInviteService>;
