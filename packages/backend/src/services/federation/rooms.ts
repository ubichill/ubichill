/**
 * 部屋のサーバーとしての答え（部屋 RPC 面）。部屋のことはこのサーバーが決める。
 *
 * - 部屋の作り: 見える人・入れる人にだけ（ほかには部屋があることも伏せる）
 * - 入室: 来訪者のホームが来訪者の鍵で頼む。入れるなら、来訪者のブラウザの origin に結び付けた Go のチケットを出す
 *   一度入れた来訪者は、部屋が続く間は入り直しに招待を求めない
 * - 招待の権利: 部屋にいるほかのサーバーの人が頼む（相手がその人のフレンドかは、その人のホームが保証する）
 * - 見えるか: 中にいる人のホームが、その人のフレンドについて尋ねる（Application actor の署名。viewers はフレンドだという保証）
 */
import {
    type AccessType,
    acceptsNewContact,
    canJoinInstance,
    canSeeInstance,
    type DomainPolicy,
    FEDERATION_LIMITS,
    type FederationProblem,
    type GrantRequest,
    type GrantResponse,
    hostOf,
    INVITE_LIMITS,
    type InstanceAudience,
    inviteRefusal,
    isBrowserOrigin,
    type JoinRequest,
    type JoinResponse,
    parseFederationUrl,
    problemOf,
    type RoomCard,
    type VisibilityRequest,
    type VisibilityResponse,
} from '@ubichill/shared';
import type { FederationIdentity } from './identity';

export interface RoomRecord {
    id: string;
    leaderId: string;
    accessType: AccessType;
    maxUsers: number;
    worldRef: string;
}

export interface RoomsDeps {
    identity: FederationIdentity;
    allowHttp: boolean;
    policyOf(domain: string): DomainPolicy;
    rooms: {
        find(instanceId: string): Promise<RoomRecord | undefined>;
        /** ワールドの名前とサムネイル（開けなければ undefined） */
        look(record: RoomRecord): Promise<{ name: string; image: string | null } | undefined>;
    };
    presence(): Promise<ReadonlyMap<string, { memberIds: readonly string[] }>>;
    /** その人のフレンド（このサーバーが知っている分。ほかのサーバーの actor なら、その actor とフレンドのこのサーバーのユーザー） */
    friendsOf(id: string): Promise<ReadonlySet<string>>;
    invites: {
        findValid(instanceId: string, inviteeId: string, now: Date): Promise<unknown | undefined>;
        upsert(input: {
            instanceId: string;
            inviterId: string;
            inviteeId: string;
            message: string | null;
            expiresAt: Date;
        }): Promise<unknown>;
    };
    admissions: {
        admit(instanceId: string, actorId: string, now: Date): Promise<void>;
        isAdmitted(instanceId: string, actorId: string): Promise<boolean>;
    };
    /** Go のチケット（来訪者のブラウザの origin に結び付ける） */
    ticket(
        instanceId: string,
        participant: { id: string; name: string },
        origin: string,
    ): Promise<{ token: string; expiresAt: number; protocolVersion: number }>;
    /** このサーバーの Go の WebSocket（絶対 URL） */
    wsUrl: string;
    now(): number;
}

export interface Visitor {
    id: string;
    domain: string;
    name: string | null;
    account: string;
}

type Outcome<T> = { ok: true; value: T } | { ok: false; problem: FederationProblem };
const fail = <T>(status: number, code: FederationProblem['code'], title: string): Outcome<T> => ({
    ok: false,
    problem: problemOf(status, code, title),
});

export function createRooms(deps: RoomsDeps) {
    const now = () => new Date(deps.now());

    const audienceOf = (
        record: RoomRecord,
        presence: ReadonlyMap<string, { memberIds: readonly string[] }>,
    ): InstanceAudience => ({
        accessType: record.accessType,
        leaderId: record.leaderId,
        memberIds: presence.get(record.id)?.memberIds ?? [],
    });

    /** 部屋の作り（RoomCard）。人の一覧は出さず人数だけ。リーダーはこのサーバーのユーザーなので actor の URL にする。 */
    const cardOf = async (record: RoomRecord, members: number): Promise<RoomCard | undefined> => {
        const look = await deps.rooms.look(record);
        if (!look) return undefined;
        return {
            id: deps.identity.instanceUrl(record.id),
            name: look.name,
            image: look.image,
            accessType: record.accessType,
            members,
            capacity: record.maxUsers,
            leader: deps.identity.actorUrl(record.leaderId),
            world: { url: record.worldRef, name: look.name },
        };
    };

    /** 招待・入室の記録で入れるか。 */
    const invitedOrAdmitted = async (instanceId: string, actorId: string) =>
        !!(await deps.invites.findValid(instanceId, actorId, now())) ||
        (await deps.admissions.isAdmitted(instanceId, actorId));

    /** 見る人にとって、見えるか・入れるか。extraFriends は、ほかのサーバーが保証したフレンド。 */
    const accessFor = async (
        record: RoomRecord,
        audience: InstanceAudience,
        viewer: string,
        extraFriends: readonly string[] = [],
    ) => {
        const known = await deps.friendsOf(viewer);
        const friends = new Set([...known, ...extraFriends]);
        const invited = await invitedOrAdmitted(record.id, viewer);
        return {
            visible: canSeeInstance(audience, viewer, friends),
            joinable: canJoinInstance(audience, viewer, friends, { invited }),
        };
    };

    const findLocal = async (roomUrl: string) => {
        const instanceId = deps.identity.localInstanceIdOf(roomUrl);
        return instanceId ? deps.rooms.find(instanceId) : undefined;
    };

    return {
        /** 部屋の作り（招待に載せる。見る人を問わない）。 */
        async card(instanceId: string): Promise<RoomCard | undefined> {
            const record = await deps.rooms.find(instanceId);
            if (!record) return undefined;
            return cardOf(record, (await deps.presence()).get(record.id)?.memberIds.length ?? 0);
        },

        /** `GET /ap/instances/:id`（署名した人が見る人）。見えなければ undefined（あることも伏せる）。 */
        async describe(viewer: string, instanceId: string): Promise<{ room: RoomCard; canJoin: boolean } | undefined> {
            const record = await deps.rooms.find(instanceId);
            if (!record) return undefined;
            const presence = await deps.presence();
            const audience = audienceOf(record, presence);
            const access = await accessFor(record, audience, viewer);
            if (!access.visible && !access.joinable) return undefined;
            const room = await cardOf(record, audience.memberIds.length);
            return room && { room, canJoin: access.joinable };
        },

        /** `POST /federation/v1/rooms/join`（来訪者の鍵・nonce 付き）。 */
        async join(visitor: Visitor, request: JoinRequest): Promise<Outcome<JoinResponse>> {
            const record = await findLocal(request.room);
            if (!record) return fail(404, 'not-found', '部屋が見つかりません');
            // 来訪者のブラウザは、来訪者のホームの画面（ホスト名が同じ。開発ではポートだけ違う）
            const origin = isBrowserOrigin(request.clientOrigin, { allowHttp: deps.allowHttp })
                ? parseFederationUrl(request.clientOrigin, { allowHttp: deps.allowHttp })
                : null;
            const visitorHost = parseFederationUrl(visitor.id, { allowHttp: deps.allowHttp });
            if (!origin || !visitorHost || origin.hostname !== visitorHost.hostname) {
                return fail(400, 'bad-request', 'clientOrigin が来訪者のサーバーではありません');
            }
            const presence = await deps.presence();
            const audience = audienceOf(record, presence);
            const access = await accessFor(record, audience, visitor.id);
            const admitted = await deps.admissions.isAdmitted(record.id, visitor.id);
            if (!acceptsNewContact(deps.policyOf(visitor.domain)) && !admitted) {
                return fail(403, 'domain-limited', 'このサーバーからの来訪は受けていません');
            }
            if (!access.joinable) {
                return access.visible
                    ? fail(403, 'invite-required', '入るには招待が要ります')
                    : fail(404, 'not-found', '部屋が見つかりません');
            }
            const inside = audience.memberIds.includes(visitor.id);
            if (!inside && audience.memberIds.length >= record.maxUsers) return fail(409, 'full', '満員です');
            const fromSameDomain = [...presence.values()]
                .flatMap((room) => room.memberIds)
                .filter((id) => hostOf(id) === visitor.domain).length;
            if (!inside && fromSameDomain >= FEDERATION_LIMITS.MAX_VISITORS_PER_DOMAIN) {
                return fail(429, 'rate-limited', 'このサーバーからの来訪者が多すぎます');
            }
            const name = Array.from((visitor.name ?? visitor.account.split('@')[0] ?? '来訪者').trim())
                .slice(0, FEDERATION_LIMITS.VISITOR_NAME_MAX)
                .join('');
            const room = await cardOf(record, audience.memberIds.length);
            if (!room) return fail(503, 'unavailable', 'ワールドを開けません');
            const grant = await deps.ticket(record.id, { id: visitor.id, name }, origin.origin);
            await deps.admissions.admit(record.id, visitor.id, now());
            return {
                ok: true,
                value: {
                    ticket: grant.token,
                    wsUrl: deps.wsUrl,
                    expiresAt: new Date(grant.expiresAt).toISOString(),
                    room,
                    participant: { id: visitor.id, name },
                    protocolVersion: grant.protocolVersion,
                },
            };
        },

        /** `POST /federation/v1/rooms/grants`（招く人の鍵・nonce 付き）。招く人が部屋にいること。 */
        async grant(inviter: Visitor, request: GrantRequest): Promise<Outcome<GrantResponse>> {
            const record = await findLocal(request.room);
            if (!record) return fail(404, 'not-found', '部屋が見つかりません');
            const presence = await deps.presence();
            const audience = audienceOf(record, presence);
            if (!audience.memberIds.includes(inviter.id))
                return fail(403, 'not-inside', '部屋にいる人だけが招待できます');
            const endTime = Date.parse(request.endTime);
            const expiresAt = new Date(
                Math.min(
                    Number.isFinite(endTime) ? endTime : Number.POSITIVE_INFINITY,
                    deps.now() + INVITE_LIMITS.INVITE_TTL_MS,
                ),
            );
            // 相手が招く人のフレンドかは、招く人のホームが保証する。部屋の規則（作成者のフレンドか）はここで確かめる
            const friends = { inviter: new Set(request.invitees), leader: await deps.friendsOf(record.leaderId) };
            const results: GrantResponse['results'] = [];
            for (const invitee of new Set(request.invitees)) {
                const parsed = parseFederationUrl(invitee, { allowHttp: deps.allowHttp });
                const host = parsed ? hostOf(parsed.href) : null;
                // このサーバーのユーザーは ID で持つ（入室の確認がユーザー ID で引く）
                const id = (parsed && deps.identity.localUserIdOf(parsed.href)) ?? parsed?.href;
                if (
                    !parsed ||
                    !host ||
                    !id ||
                    (host !== deps.identity.domain && !acceptsNewContact(deps.policyOf(host)))
                ) {
                    results.push({ invitee, granted: false, reason: 'not-allowed' });
                    continue;
                }
                const leaderFriends = new Set([...friends.leader]);
                const refusal = inviteRefusal(audience, inviter.id, id, {
                    inviter: new Set([...friends.inviter].map((i) => deps.identity.localUserIdOf(i) ?? i)),
                    leader: leaderFriends,
                });
                if (refusal) {
                    results.push({ invitee, granted: false, reason: refusal });
                    continue;
                }
                await deps.invites.upsert({
                    instanceId: record.id,
                    inviterId: inviter.id,
                    inviteeId: id,
                    message: null,
                    expiresAt,
                });
                results.push({ invitee, granted: true, expiresAt: expiresAt.toISOString() });
            }
            const room = await cardOf(record, audience.memberIds.length);
            return { ok: true, value: { results, ...(room ? { room } : {}) } };
        },

        /** `POST /federation/v1/rooms/visibility`（中にいる人のホームの Application actor の署名）。 */
        async visibility(signerHost: string, request: VisibilityRequest): Promise<Outcome<VisibilityResponse>> {
            if (hostOf(request.member) !== signerHost)
                return fail(403, 'forbidden', '中にいる人のホームだけが尋ねられます');
            const record = await findLocal(request.room);
            if (!record) return fail(404, 'not-found', '部屋が見つかりません');
            const presence = await deps.presence();
            const audience = audienceOf(record, presence);
            if (!audience.memberIds.includes(request.member)) return fail(409, 'not-inside', 'その人は部屋にいません');
            const results: VisibilityResponse['results'] = [];
            for (const viewer of new Set(request.viewers)) {
                // viewers は member のフレンドだという保証（member のホームが署名している）
                const access = await accessFor(record, audience, deps.identity.localUserIdOf(viewer) ?? viewer, [
                    request.member,
                ]);
                results.push({ viewer, visible: access.visible, joinable: access.joinable });
            }
            const room = await cardOf(record, audience.memberIds.length);
            return { ok: true, value: { results, ...(room ? { room } : {}), ttl: 30 } };
        },
    };
}

export type Rooms = ReturnType<typeof createRooms>;
