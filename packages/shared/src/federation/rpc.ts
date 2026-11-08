/**
 * 部屋 RPC 面（`/federation/v1/...`）の要求と応答。部屋のことは部屋のサーバーが決める（同期の問い）。
 * どれも RFC 9421 の署名付き（入室・招待の権利は nonce 必須）。署名した actor が操作の主体で、本文で別の主体を名乗れない。
 * 受けるときは知らない項目を無視する（.strict() にしない）。エラーは problem+json（RFC 9457）。
 */
import { z } from 'zod';
import { FEDERATION_LIMITS, type RoomCard } from './protocol';

const Url = z.string().min(1).max(2048);

export const RoomCardSchema: z.ZodType<RoomCard> = z.object({
    id: Url,
    name: z.string().min(1).max(200),
    image: Url.nullable(),
    accessType: z.enum(['public', 'friend_plus', 'friend_only', 'invite_only']),
    members: z.number().int().min(0).max(10_000),
    capacity: z.number().int().min(1).max(10_000),
    leader: Url,
    world: z.object({ url: Url, name: z.string().min(1).max(200) }),
    protocolVersion: z.number().int().min(1).max(1000).optional(),
});

/** 入室（来訪者のホームが、来訪者の鍵で部屋のサーバーへ）。 */
export const JoinRequestSchema = z.object({
    room: Url,
    /** 入室に使う招待（Invite の id）。無くても、見える・入れる部屋なら入れる */
    invite: Url.optional(),
    /** 来訪者のブラウザの origin（Go のチケットをこの origin の接続に結び付ける） */
    clientOrigin: Url,
    /**
     * 会いに行くフレンド（中にいる人の actor の URL）。部屋のサーバーは、この人たちとの関係から先に確かめる
     * （中にいる人が多くても、現在地で「入れる」と出た人との関係で入れるように）。関係そのものはホームに確かめる。
     */
    via: z.array(Url).max(FEDERATION_LIMITS.MAX_FRIENDSHIP_CHECKS).optional(),
});
export type JoinRequest = z.infer<typeof JoinRequestSchema>;

export const JoinResponseSchema = z.object({
    ticket: z.string().min(1).max(4096),
    /** 部屋のサーバーの WebSocket（部屋のサーバーのオリジン） */
    wsUrl: Url,
    expiresAt: z.string(),
    room: RoomCardSchema,
    /** Go の参加者の ID（来訪者の actor の id） */
    participant: z.object({ id: Url, name: z.string() }),
    /** 部屋のサーバーの Go の通信の版（来訪者の画面が対応していなければ入らない） */
    protocolVersion: z.number().int().min(1),
});
export type JoinResponse = z.infer<typeof JoinResponseSchema>;

/** 招待の権利（部屋の外のサーバーの人が招くとき、招く人のホームが招く人の鍵で）。 */
export const GrantRequestSchema = z.object({
    room: Url,
    /** 届ける Invite の id */
    invite: Url,
    invitees: z.array(Url).min(1).max(FEDERATION_LIMITS.MAX_GRANT_INVITEES),
    endTime: z.string(),
});
export type GrantRequest = z.infer<typeof GrantRequestSchema>;

export const GrantResponseSchema = z.object({
    results: z.array(
        z.object({
            invitee: Url,
            granted: z.boolean(),
            reason: z.string().optional(),
            expiresAt: z.string().optional(),
        }),
    ),
    room: RoomCardSchema.optional(),
});
export type GrantResponse = z.infer<typeof GrantResponseSchema>;

/** 見えるか・入れるか（中にいる人のホームが、Application actor で。viewers は member のフレンドだという保証付き）。 */
export const VisibilityRequestSchema = z.object({
    room: Url,
    member: Url,
    viewers: z.array(Url).min(1).max(FEDERATION_LIMITS.MAX_VISIBILITY_VIEWERS),
});
export type VisibilityRequest = z.infer<typeof VisibilityRequestSchema>;

export const VisibilityResponseSchema = z.object({
    results: z.array(z.object({ viewer: Url, visible: z.boolean(), joinable: z.boolean() })),
    room: RoomCardSchema.optional(),
    ttl: z.number().int().min(0).max(3600),
});
export type VisibilityResponse = z.infer<typeof VisibilityResponseSchema>;

/** フレンドの現在地（見る人のホームが、見る人の鍵で、見られる人のホームへ）。 */
export const PresenceRequestSchema = z.object({
    subjects: z.array(Url).min(1).max(FEDERATION_LIMITS.MAX_PRESENCE_SUBJECTS),
});
export type PresenceRequest = z.infer<typeof PresenceRequestSchema>;

export const PresenceStatus = z.enum(['offline', 'online', 'private', 'in_room']);
export type PresenceStatus = z.infer<typeof PresenceStatus>;

export const PresenceResponseSchema = z.object({
    presence: z.array(
        z.object({
            subject: Url,
            status: PresenceStatus,
            room: RoomCardSchema.optional(),
            joinable: z.boolean().optional(),
        }),
    ),
    ttl: z.number().int().min(0).max(3600),
});
export type PresenceResponse = z.infer<typeof PresenceResponseSchema>;
export type PresenceEntry = PresenceResponse['presence'][number];

/** 2 人がフレンドか（ずれを直すため。Application actor で）。 */
/**
 * 2 人がフレンドか（user のホームが答える）。尋ねてよいのは other のホームと、user が来訪中の部屋のサーバー。
 */
export const FriendshipCheckRequestSchema = z.object({ user: Url, other: Url });
export type FriendshipCheckRequest = z.infer<typeof FriendshipCheckRequestSchema>;
export const FriendshipCheckResponseSchema = z.object({ friends: z.boolean() });

/** RPC のエラーの種類（problem+json の code）。 */
export type FederationErrorCode =
    | 'unauthorized'
    | 'forbidden'
    | 'not-found'
    | 'invite-required'
    | 'full'
    | 'domain-limited'
    | 'rate-limited'
    | 'not-inside'
    | 'unavailable'
    | 'bad-request';

export interface FederationProblem {
    type: string;
    title: string;
    status: number;
    code: FederationErrorCode;
}

export const problemOf = (status: number, code: FederationErrorCode, title: string): FederationProblem => ({
    type: `https://ubichill.com/ns/federation/errors#${code}`,
    title,
    status,
    code,
});
