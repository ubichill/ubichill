/**
 * このサーバーのユーザーが、ほかのサーバーの部屋へ行く（ホームとして仲介する）。
 *
 * 画面（SPA）はこのサーバーのまま。部屋の作りの取得と入室は、このサーバーがユーザーの鍵で部屋のサーバーへ頼み、
 * 返ってきた Go のチケット（ユーザーのブラウザの origin に結び付いたもの）で、ブラウザが部屋のサーバーの WebSocket につなぐ。
 * トークンを URL に載せない・リダイレクトしない（docs/design/federation.md の来訪）。
 */
import {
    type DomainPolicy,
    exchanges,
    FEDERATION_PATHS,
    type GrantResponse,
    GrantResponseSchema,
    hostOf,
    JoinResponseSchema,
    originForDomain,
    parseFederationUrl,
    type RoomAddress,
    type RoomCard,
    RoomCardSchema,
    SIGNATURE_TIMING,
} from '@ubichill/shared';
import { z } from 'zod';
import type { FederationIdentity } from './identity';
import type { Transport } from './transport';

export interface TravelDeps {
    identity: FederationIdentity;
    allowHttp: boolean;
    transport: Pick<Transport, 'get' | 'post'>;
    policyOf(domain: string): DomainPolicy;
    visits: {
        set(userId: string, roomUrl: string, room: RoomCard, now: Date): Promise<void>;
        touch(userId: string, roomUrl: string, now: Date): Promise<boolean>;
        clear(userId: string, roomUrl?: string): Promise<void>;
    };
    now(): number;
}

const DescribeSchema = z.object({ room: RoomCardSchema, canJoin: z.boolean() });

export type TravelError = 'blocked' | 'not-found' | 'invite-required' | 'full' | 'unavailable' | 'rejected';

/** 画面へ返す入室の権利（このサーバーの部屋の InstanceGrant と同じ形）。 */
export interface RemoteGrant {
    token: string;
    /** 部屋のサーバーの WebSocket */
    url: string;
    expiresAt: number;
    userId: string;
    protocolVersion: number;
}

export function createTravel(deps: TravelDeps) {
    /** 部屋のサーバーのオリジン（開発では http も試す）。 */
    const originsOf = (domain: string) => originForDomain(domain, { allowHttp: deps.allowHttp });

    /**
     * 部屋のサーバーが返した WebSocket を、ブラウザにつながせてよいか。部屋のサーバーと同じホスト名に限る
     * （ほかの相手へつながせない。ポートは見ない: 本番は同じオリジン、開発は Go だけ別のポート）。
     */
    const wsUrlOf = (wsUrl: string, domain: string): boolean => {
        const secure = wsUrl.startsWith('wss://');
        if (!secure && !(deps.allowHttp && wsUrl.startsWith('ws://'))) return false;
        const url = parseFederationUrl(`${secure ? 'https' : 'http'}://${wsUrl.slice(secure ? 6 : 5)}`, {
            allowHttp: deps.allowHttp,
        });
        const room = parseFederationUrl(`https://${domain}`);
        return !!url && !!room && url.hostname === room.hostname;
    };

    const errorOf = (status: number, code: unknown): TravelError =>
        status === 404
            ? 'not-found'
            : status === 403 && code === 'invite-required'
              ? 'invite-required'
              : status === 409 && code === 'full'
                ? 'full'
                : status >= 500 || status === 0
                  ? 'unavailable'
                  : 'rejected';

    /** 会いに行くフレンド（部屋のサーバーがその人との関係から先に確かめる）の問い合わせの形。 */
    const viaQuery = (via: readonly string[]) =>
        via.length > 0 ? `?${new URLSearchParams(via.map((v) => ['via', v])).toString()}` : '';

    /** ほかのサーバーの部屋の作り（見えなければ not-found）。via は会いに行くフレンドの actor の URL。 */
    const describe = async (
        userId: string,
        address: RoomAddress & { domain: string },
        via: readonly string[] = [],
    ): Promise<{ ok: true; room: RoomCard; canJoin: boolean } | { ok: false; error: TravelError }> => {
        if (!exchanges(deps.policyOf(address.domain))) return { ok: false, error: 'blocked' };
        for (const origin of originsOf(address.domain)) {
            const response = await deps.transport
                .get(`${origin}${FEDERATION_PATHS.instance(address.id)}${viaQuery(via)}`, {
                    signAs: { kind: 'user', userId },
                    maxBytes: 64 * 1024,
                })
                .catch(() => null);
            if (!response) continue;
            if (response.status !== 200) return { ok: false, error: errorOf(response.status, undefined) };
            const parsed = DescribeSchema.safeParse(response.json);
            if (!parsed.success || hostOf(parsed.data.room.id) !== address.domain)
                return { ok: false, error: 'unavailable' };
            return { ok: true, room: parsed.data.room, canJoin: parsed.data.canJoin };
        }
        return { ok: false, error: 'unavailable' };
    };

    return {
        describe,

        /**
         * 入る。部屋のサーバーへユーザーの鍵（nonce 付き）で頼み、チケットを受け取る。
         * WebSocket は部屋のサーバーのホストに限る（ほかへつながせない）。入ったら現在地として覚える。
         */
        async join(
            userId: string,
            address: RoomAddress & { domain: string },
            clientOrigin: string,
            via: readonly string[] = [],
        ): Promise<{ ok: true; grant: RemoteGrant; room: RoomCard } | { ok: false; error: TravelError }> {
            if (!exchanges(deps.policyOf(address.domain))) return { ok: false, error: 'blocked' };
            for (const origin of originsOf(address.domain)) {
                const room = `${origin}${FEDERATION_PATHS.instance(address.id)}`;
                const response = await deps.transport
                    .post(
                        `${origin}${FEDERATION_PATHS.rpc.join}`,
                        { room, clientOrigin, ...(via.length > 0 ? { via } : {}) },
                        {
                            signAs: { kind: 'user', userId },
                            ttlSec: SIGNATURE_TIMING.RPC_TTL_SEC,
                            contentType: 'application/json',
                            nonce: true,
                            maxBytes: 16 * 1024,
                        },
                    )
                    .catch(() => null);
                if (!response) continue;
                if (response.status !== 200) {
                    const code = (response.json as { code?: unknown } | undefined)?.code;
                    return { ok: false, error: errorOf(response.status, code) };
                }
                const parsed = JoinResponseSchema.safeParse(response.json);
                if (!parsed.success) return { ok: false, error: 'unavailable' };
                if (!wsUrlOf(parsed.data.wsUrl, address.domain) || hostOf(parsed.data.room.id) !== address.domain) {
                    return { ok: false, error: 'unavailable' };
                }
                await deps.visits.set(userId, parsed.data.room.id, parsed.data.room, new Date(deps.now()));
                return {
                    ok: true,
                    room: parsed.data.room,
                    grant: {
                        token: parsed.data.ticket,
                        url: parsed.data.wsUrl,
                        expiresAt: Date.parse(parsed.data.expiresAt),
                        userId: parsed.data.participant.id,
                        protocolVersion: parsed.data.protocolVersion,
                    },
                };
            }
            return { ok: false, error: 'unavailable' };
        },

        /**
         * 来訪の記録が途切れた（通信が切れていた・backend が知らせを受けられなかった）後に、続けている知らせが来た。
         * 部屋のサーバーに部屋を尋ね直して、来訪を記録し直す（部屋にいるかは、現在地を尋ねたときに部屋のサーバーが確かめる）。
         */
        async resume(userId: string, address: RoomAddress & { domain: string }): Promise<boolean> {
            const described = await describe(userId, address);
            if (!described.ok) return false;
            await deps.visits.set(userId, described.room.id, described.room, new Date(deps.now()));
            return true;
        },

        /** 来訪を続けている（画面から 30 秒ごと）。 */
        heartbeat: (userId: string, roomUrl: string) => deps.visits.touch(userId, roomUrl, new Date(deps.now())),

        /** 来訪をやめた（roomUrl を渡せば、その部屋への来訪のときだけ）。 */
        leave: (userId: string, roomUrl?: string) => deps.visits.clear(userId, roomUrl),

        /**
         * 来訪中の部屋に招待する権利を、部屋のサーバーに作ってもらう（招く人の鍵・nonce 付き）。
         * invitees は actor の URL（このサーバーのユーザーも URL にして渡す）。
         */
        async grant(
            userId: string,
            roomUrl: string,
            input: { inviteId: string; invitees: string[]; endTime: Date },
        ): Promise<GrantResponse | null> {
            const room = parseFederationUrl(roomUrl, { allowHttp: deps.allowHttp });
            const host = room ? hostOf(room.href) : null;
            if (!room || !host || !exchanges(deps.policyOf(host))) return null;
            const response = await deps.transport
                .post(
                    `${room.origin}${FEDERATION_PATHS.rpc.grants}`,
                    {
                        room: room.href,
                        invite: input.inviteId,
                        invitees: input.invitees,
                        endTime: input.endTime.toISOString(),
                    },
                    {
                        signAs: { kind: 'user', userId },
                        ttlSec: SIGNATURE_TIMING.RPC_TTL_SEC,
                        contentType: 'application/json',
                        nonce: true,
                        maxBytes: 16 * 1024,
                    },
                )
                .catch(() => null);
            if (response?.status !== 200) return null;
            const parsed = GrantResponseSchema.safeParse(response.json);
            return parsed.success ? parsed.data : null;
        },
    };
}

export type Travel = ReturnType<typeof createTravel>;
