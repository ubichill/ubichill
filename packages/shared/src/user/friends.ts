/**
 * フレンドの関係の純粋なロジック（backend と frontend で同じ規則を使う）。公開範囲・招待は instanceAccess.ts。
 */

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

/**
 * フレンドの現在地をインスタンスごとにまとめる。見えないインスタンスにいるフレンドは「非公開の場所」にまとめ、
 * どのインスタンスかは出さない。インスタンスはフレンドの多い順。
 */
export function groupFriendLocations<I extends { id: string }>(
    friendIds: readonly string[],
    instanceOf: (userId: string) => I | undefined,
    canSee: (instance: I, friendId: string) => boolean,
): { locations: Array<{ instance: I; friendIds: string[] }>; privateFriendIds: string[]; elsewhereIds: string[] } {
    const located = friendIds.map((id) => ({ id, instance: instanceOf(id) }));
    const visible = located.filter((f): f is { id: string; instance: I } => !!f.instance && canSee(f.instance, f.id));
    const byInstance = new Map<string, { instance: I; friendIds: string[] }>();
    for (const f of visible) {
        const group = byInstance.get(f.instance.id) ?? { instance: f.instance, friendIds: [] };
        byInstance.set(f.instance.id, { ...group, friendIds: [...group.friendIds, f.id] });
    }
    return {
        locations: [...byInstance.values()].sort((a, b) => b.friendIds.length - a.friendIds.length),
        privateFriendIds: located.filter((f) => !!f.instance && !canSee(f.instance, f.id)).map((f) => f.id),
        elsewhereIds: located.filter((f) => !f.instance).map((f) => f.id),
    };
}

/** 一覧・検索に出すユーザーの公開情報。 */
export interface UserSummary {
    id: string;
    name: string;
    handle: string;
    /** プロフィール画像の URL（無ければ null） */
    image: string | null;
    /** 自己紹介（書いていなければ null） */
    bio: string | null;
    /** ひとこと（一覧のカードに出す。書いていなければ null か無し） */
    status?: string | null;
    /** ほかのサーバーの人ならそのドメイン（id は actor の URL、handle は `handle@domain`） */
    domain?: string;
}

/** ほかのサーバーの人の ID（actor の URL）か。このサーバーのユーザー ID は URL にならない。 */
export const isRemoteUserId = (id: string): boolean => id.startsWith('https://') || id.startsWith('http://');

/** ほかのサーバーの人との、フレンド以外の関係（このサーバーの人には付けない）。 */
export interface RemoteRelation {
    /** その人のサーバーがフレンドに対応していない（Mastodon・Misskey など）。フレンド申請は出さない */
    friendsUnsupported?: true;
    /** フェディバースでこの人にフォローされている（pending は承認待ち） */
    followsYou?: 'accepted' | 'pending';
}

/** 検索結果・プロフィール（自分との関係付き）。 */
export interface UserWithFriendship extends UserSummary, RemoteRelation {
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
