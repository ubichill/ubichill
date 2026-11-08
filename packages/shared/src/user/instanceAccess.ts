/**
 * インスタンスの公開範囲（誰に見えて、誰が入れるか）と、招待・リクエストインバイトの規則。
 * backend の認可と画面の表示で同じ関数を使う。ID はこのサーバーのユーザー ID（連合ではリモートの actor の URI も同じ扱い）。
 *
 * | 種類 | 見える人 | 入れる人 |
 * |---|---|---|
 * | パブリック | 誰でも | ログインしている人 |
 * | フレンド+ | 中にいる人（作成者・参加者）のフレンド | 見える人 |
 * | フレンドのみ | 作成者のフレンド | 見える人 |
 * | 招待のみ | 中にいる人のフレンド（URL だけでは見えない） | 招待された人 |
 *
 * 作成者と参加者はいつも見えて入れる。招待された人は、公開範囲にかかわらず入れる（送った人が送れる人か、送るときに確かめる）。
 */
import { z } from 'zod';
import type { AccessType } from '../schemas/instance.schema';
import type { UserSummary } from './friends';

/** 公開範囲の表示名。 */
export const ACCESS_TYPE_LABELS: Record<AccessType, string> = {
    public: 'パブリック',
    friend_plus: 'フレンド+',
    friend_only: 'フレンドのみ',
    invite_only: '招待のみ',
};

/** 公開範囲の判定に要る情報。 */
export interface InstanceAudience {
    accessType: AccessType;
    leaderId: string;
    /** いま参加している人。 */
    memberIds: readonly string[];
}

const isInside = (audience: InstanceAudience, userId: string): boolean =>
    userId === audience.leaderId || audience.memberIds.includes(userId);

const friendOfAnyoneInside = (audience: InstanceAudience, friendIds: ReadonlySet<string>): boolean =>
    friendIds.has(audience.leaderId) || audience.memberIds.some((id) => friendIds.has(id));

/** インスタンスが一覧・フレンドの現在地に見えるか。見えない人には、あることも伏せる。 */
export function canSeeInstance(
    audience: InstanceAudience,
    viewerId: string | null,
    viewerFriendIds: ReadonlySet<string>,
): boolean {
    if (audience.accessType === 'public') return true;
    if (!viewerId) return false;
    if (isInside(audience, viewerId)) return true;
    switch (audience.accessType) {
        case 'friend_only':
            return viewerFriendIds.has(audience.leaderId);
        case 'friend_plus':
        case 'invite_only':
            return friendOfAnyoneInside(audience, viewerFriendIds);
    }
}

/** インスタンスに入れるか。招待のみは招待された人だけ（見えるフレンドでも、招待が要る）。 */
export function canJoinInstance(
    audience: InstanceAudience,
    viewerId: string | null,
    viewerFriendIds: ReadonlySet<string>,
    options: { invited?: boolean } = {},
): boolean {
    if (!viewerId) return false;
    if (isInside(audience, viewerId) || options.invited) return true;
    if (audience.accessType === 'invite_only') return false;
    return canSeeInstance(audience, viewerId, viewerFriendIds);
}

// ── 招待・リクエストインバイト ──────────────────────────────

export const INVITE_LIMITS = {
    /** 招待で入れる時間（部屋が消えれば招待も消える） */
    INVITE_TTL_MS: 24 * 60 * 60 * 1000,
    /** リクエストインバイトに答えられる時間 */
    REQUEST_TTL_MS: 60 * 60 * 1000,
    /** 招待に添える一言 */
    MESSAGE_MAX: 80,
    /** 一度に招待できる人数 */
    MAX_INVITEES: 20,
} as const;

/** 招待を送れない理由。 */
export type InviteRefusal =
    /** 自分自身 */
    | 'self'
    /** 送る人がその部屋にいない（部屋にいる人だけが送れる） */
    | 'not-inside'
    /** 相手が送る人のフレンドでない */
    | 'not-friend'
    /** 相手がもう部屋にいる */
    | 'already-inside'
    /** 作成者でない人は、フレンドのみ・招待のみの部屋には作成者のフレンドにしか送れない */
    | 'needs-leader'
    /** 相手のサーバー・部屋のサーバーとやり取りできない（連合） */
    | 'unavailable'
    /** 相手のサーバーが招待に対応していない（連合） */
    | 'unsupported';

export const INVITE_REFUSAL_MESSAGES: Record<InviteRefusal, string> = {
    self: '自分には送れません',
    'not-inside': '部屋にいる人だけが招待を送れます',
    'not-friend': 'フレンドにだけ送れます',
    'already-inside': 'もうこの部屋にいます',
    'needs-leader': '部屋を作った人に招待してもらってください',
    unavailable: '相手のサーバーとやり取りできません',
    unsupported: '相手のサーバーは招待に対応していません',
};

/**
 * 送る人（inviter）が相手（invitee）をこの部屋に招待できるか。できれば null、できなければ理由。
 *
 * | 公開範囲 | 作成者が送る | 作成者以外が送る |
 * |---|---|---|
 * | パブリック・フレンド+ | 送れる | 送れる |
 * | フレンドのみ・招待のみ | 送れる | 相手が作成者のフレンドのときだけ |
 */
export function inviteRefusal(
    audience: InstanceAudience,
    inviterId: string,
    inviteeId: string,
    friends: { inviter: ReadonlySet<string>; leader: ReadonlySet<string> },
): InviteRefusal | null {
    if (inviterId === inviteeId) return 'self';
    if (!isInside(audience, inviterId)) return 'not-inside';
    if (!friends.inviter.has(inviteeId)) return 'not-friend';
    if (isInside(audience, inviteeId)) return 'already-inside';
    if (inviterId === audience.leaderId) return null;
    switch (audience.accessType) {
        case 'public':
        case 'friend_plus':
            return null;
        case 'friend_only':
        case 'invite_only':
            return friends.leader.has(inviteeId) ? null : 'needs-leader';
    }
}

/** リクエストインバイトを送れない理由。 */
export type InviteRequestRefusal = 'self' | 'not-friend' | 'offline' | 'can-join' | 'unsupported';

export const INVITE_REQUEST_REFUSAL_MESSAGES: Record<InviteRequestRefusal, string> = {
    self: '自分には送れません',
    'not-friend': 'フレンドにだけ送れます',
    offline: 'いま部屋にいません',
    'can-join': 'そのまま入れます',
    unsupported: '相手のサーバーはリクエストに対応していません',
};

/**
 * requester が target（フレンド）に「部屋に入れて」と頼めるか。target のいる部屋（いなければ null）で決める。
 * もう入れる部屋なら頼まず入ればよい。
 */
export function inviteRequestRefusal(
    requesterId: string,
    targetId: string,
    requesterFriendIds: ReadonlySet<string>,
    /** 相手のいる部屋。'remote' はほかのサーバーの部屋（入れるかは部屋のサーバーが決めるので、頼むのは止めない） */
    targetRoom: InstanceAudience | 'remote' | null,
): InviteRequestRefusal | null {
    if (requesterId === targetId) return 'self';
    if (!requesterFriendIds.has(targetId)) return 'not-friend';
    if (!targetRoom) return 'offline';
    if (targetRoom !== 'remote' && canJoinInstance(targetRoom, requesterId, requesterFriendIds)) return 'can-join';
    return null;
}

// ── API の形 ──────────────────────────────────────────────

/** `POST /instances/:id/invites`。 */
export const SendInvitesRequestSchema = z
    .object({
        /** このサーバーのユーザー ID か、ほかのサーバーの人の actor の URL */
        userIds: z.array(z.string().min(1).max(2048)).min(1).max(INVITE_LIMITS.MAX_INVITEES),
        message: z.string().trim().max(INVITE_LIMITS.MESSAGE_MAX).optional(),
    })
    .strict();
export type SendInvitesRequest = z.infer<typeof SendInvitesRequestSchema>;

/** 1 人ずつの結果（送れなかった人には理由）。 */
export type SendInviteResult = { userId: string; ok: true } | { userId: string; ok: false; reason: InviteRefusal };

export interface SendInvitesResponse {
    results: SendInviteResult[];
}

/** `GET /instances/:id/invite-candidates`: 招待の画面に出すフレンド。 */
export interface InviteCandidate {
    user: UserSummary;
    /** 送れなければ理由 */
    refusal: InviteRefusal | null;
    /** どこかの部屋にいる */
    online: boolean;
}

export interface InviteCandidatesResponse {
    candidates: InviteCandidate[];
}

/** `POST /social/invite-requests`。 */
export const InviteRequestBodySchema = z.object({ userId: z.string().min(1).max(2048) }).strict();

export interface InviteRequestResponse {
    /** 期限内のリクエストがあったので、送り直さなかった */
    alreadyRequested: boolean;
}

/** リクエストに答えられない理由（招待を送れない理由を含む）。 */
export type InviteAnswerRefusal = 'no-request' | 'offline' | InviteRefusal;

export const INVITE_ANSWER_REFUSAL_MESSAGES: Record<InviteAnswerRefusal, string> = {
    ...INVITE_REFUSAL_MESSAGES,
    'no-request': 'リクエストの期限が過ぎました',
    offline: '部屋に入ってから招待してください',
};
