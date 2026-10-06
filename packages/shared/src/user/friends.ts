/**
 * フレンドとインスタンスの公開範囲の純粋なロジック（backend の認可と frontend の表示で同じ規則を使う）。
 */
import type { AccessType } from '../schemas/instance.schema';

/** フレンドの行（`userId` が `friendId` に申請した。承認されると accepted）。 */
export interface FriendEdge {
    userId: string;
    friendId: string;
    status: 'pending' | 'accepted';
}

/** 自分から見た相手との関係。 */
export type Friendship = 'self' | 'none' | 'friends' | 'outgoing' | 'incoming';

/** 申請の向きは問わず、どちらかの行が accepted ならフレンド。そうでなければ申請の向き。 */
export function friendshipOf(edges: readonly FriendEdge[], me: string, other: string): Friendship {
    if (me === other) return 'self';
    const between = edges.filter(
        (e) => (e.userId === me && e.friendId === other) || (e.userId === other && e.friendId === me),
    );
    if (between.some((e) => e.status === 'accepted')) return 'friends';
    if (between.some((e) => e.userId === other)) return 'incoming';
    if (between.some((e) => e.userId === me)) return 'outgoing';
    return 'none';
}

/** 自分の関係を、フレンド・自分への申請・自分の申請に分ける（それぞれ相手の ID）。 */
export function friendGroupsOf(
    edges: readonly FriendEdge[],
    me: string,
): { friends: string[]; incoming: string[]; outgoing: string[] } {
    const others = [...new Set(edges.flatMap((e) => [e.userId, e.friendId]).filter((id) => id !== me))];
    const byKind = (kind: Friendship) => others.filter((id) => friendshipOf(edges, me, id) === kind);
    return { friends: byKind('friends'), incoming: byKind('incoming'), outgoing: byKind('outgoing') };
}

/** インスタンスの公開範囲の判定に要る情報。 */
export interface InstanceAudience {
    accessType: AccessType;
    leaderId: string;
    /** いま参加している人。 */
    memberIds: readonly string[];
}

/**
 * インスタンスが一覧・フレンドの現在地に見えるか（VRChat と同じ考え方）。
 * - public: 誰でも
 * - friend_plus（フレンド+）: 作成者か、参加している誰かのフレンド
 * - friend_only（フレンドのみ）: 作成者のフレンド
 * - invite_only（招待のみ）: 一覧には出さない（作成者と参加者だけ）
 * 作成者と参加している人にはいつも見える。ログインしていなければ public だけ。
 */
export function canSeeInstance(
    audience: InstanceAudience,
    viewerId: string | null,
    viewerFriendIds: ReadonlySet<string>,
): boolean {
    if (audience.accessType === 'public') return true;
    if (!viewerId) return false;
    if (viewerId === audience.leaderId || audience.memberIds.includes(viewerId)) return true;
    switch (audience.accessType) {
        case 'friend_only':
            return viewerFriendIds.has(audience.leaderId);
        case 'friend_plus':
            return viewerFriendIds.has(audience.leaderId) || audience.memberIds.some((id) => viewerFriendIds.has(id));
        default:
            return false;
    }
}

/**
 * インスタンスに入れるか。見える人は入れる。招待のみは、インスタンスの URL を受け取った人（招待された人）なら入れる。
 */
export function canJoinInstance(
    audience: InstanceAudience,
    viewerId: string | null,
    viewerFriendIds: ReadonlySet<string>,
): boolean {
    if (!viewerId) return false;
    return audience.accessType === 'invite_only' || canSeeInstance(audience, viewerId, viewerFriendIds);
}

/** 公開範囲の表示名。 */
export const ACCESS_TYPE_LABELS: Record<AccessType, string> = {
    public: 'パブリック',
    friend_plus: 'フレンド+',
    friend_only: 'フレンドのみ',
    invite_only: '招待のみ',
};

/**
 * フレンドの現在地をインスタンスごとにまとめる。見えないインスタンスにいるフレンドは「非公開の場所」にまとめ、
 * どのインスタンスかは出さない。インスタンスはフレンドの多い順。
 */
export function groupFriendLocations<I extends { id: string }>(
    friendIds: readonly string[],
    instanceOf: (userId: string) => I | undefined,
    canSee: (instance: I) => boolean,
): { locations: Array<{ instance: I; friendIds: string[] }>; privateFriendIds: string[]; elsewhereIds: string[] } {
    const located = friendIds.map((id) => ({ id, instance: instanceOf(id) }));
    const visible = located.filter((f): f is { id: string; instance: I } => !!f.instance && canSee(f.instance));
    const byInstance = new Map<string, { instance: I; friendIds: string[] }>();
    for (const f of visible) {
        const group = byInstance.get(f.instance.id) ?? { instance: f.instance, friendIds: [] };
        byInstance.set(f.instance.id, { ...group, friendIds: [...group.friendIds, f.id] });
    }
    return {
        locations: [...byInstance.values()].sort((a, b) => b.friendIds.length - a.friendIds.length),
        privateFriendIds: located.filter((f) => !!f.instance && !canSee(f.instance)).map((f) => f.id),
        elsewhereIds: located.filter((f) => !f.instance).map((f) => f.id),
    };
}

/** 一覧・検索に出すユーザーの公開情報。 */
export interface UserSummary {
    id: string;
    name: string;
    handle: string | null;
    profileImageUrl: string | null;
    /** 自己紹介（書いていなければ null） */
    bio: string | null;
}

/** 検索結果・プロフィール（自分との関係付き）。 */
export interface UserWithFriendship extends UserSummary {
    friendship: Friendship;
}

/** 自分への申請（通知に出す）。 */
export interface FriendRequestSummary extends UserSummary {
    /** 申請された日時（ISO 8601） */
    requestedAt: string;
}

/** `GET /api/v1/social/friends` */
export interface FriendsResponse {
    friends: UserSummary[];
    incoming: FriendRequestSummary[];
    outgoing: UserSummary[];
}
