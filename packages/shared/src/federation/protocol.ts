/**
 * サーバー間の連合（federation v1）の約束ごと。PROTOCOLS.md の種類 C（版の違うほかのサーバーが相手。足すだけ）。
 *
 * 2 つの面に分ける:
 * - AP 面: 人から人への知らせ（フレンドの申請・承認・解除、招待、リクエストインバイト、更新、削除）。相手の inbox へ AS2 で送る（非同期）
 * - 部屋 RPC 面: 部屋のサーバーへの問い（入室・招待の権利・見えるか・現在地・フレンドか）。部屋のサーバーが権威（同期）
 *
 * 形は ActivityPub に合わせるが、相手は ubichill 同士（未知の型は 202 で受けて捨てる）。設計は docs/design/federation.md。
 */

export const FEDERATION_VERSION = 1;

export const AS_CONTEXT = 'https://www.w3.org/ns/activitystreams';
export const UBICHILL_NS = 'https://ubichill.com/ns#';

/** activity の @context（拡張の語はその場で定義する。JSON-LD の展開はしない） */
export const ACTIVITY_CONTEXT = [
    AS_CONTEXT,
    {
        ubichill: UBICHILL_NS,
        Instance: 'ubichill:Instance',
        World: 'ubichill:World',
        RequestInvite: 'ubichill:RequestInvite',
    },
] as const;

/** actor の @context（FEP-521a の Multikey・FEP-844e の implements） */
export const ACTOR_CONTEXT = [
    AS_CONTEXT,
    'https://www.w3.org/ns/cid/v1',
    'https://w3id.org/fep/844e',
    { ubichill: UBICHILL_NS, manuallyApprovesFollowers: 'as:manuallyApprovesFollowers' },
] as const;

/** 送るときの Content-Type（受けるときは ld+json の profile 付きも同じに扱う） */
export const ACTIVITY_CONTENT_TYPE = 'application/activity+json';
export const AP_ACCEPT =
    'application/activity+json, application/ld+json; profile="https://www.w3.org/ns/activitystreams"';

/** AP のメディアタイプか（取得した文書・受けた本文）。 */
export function isActivityMediaType(contentType: string | undefined): boolean {
    if (!contentType) return false;
    const [type, ...params] = contentType.split(';').map((p) => p.trim().toLowerCase());
    if (type === 'application/activity+json') return true;
    return (
        type === 'application/ld+json' &&
        params.some((p) => p.replace(/\s/g, '') === 'profile="https://www.w3.org/ns/activitystreams"')
    );
}

/** 機能の URI（FEP-844e の implements で告知し、使う前に相手が告知しているか確かめる）。 */
export const FEDERATION_FEATURES = {
    federation: 'https://ubichill.com/ns/federation/v1',
    friends: 'https://ubichill.com/ns/federation/friends/v1',
    invites: 'https://ubichill.com/ns/federation/invites/v1',
    requestInvite: 'https://ubichill.com/ns/federation/request-invite/v1',
    presence: 'https://ubichill.com/ns/federation/presence/v1',
    visit: 'https://ubichill.com/ns/federation/visit/v1',
    rfc9421Ed25519: 'https://datatracker.ietf.org/doc/html/rfc9421#name-eddsa-using-curve-edwards25',
} as const;
export type FederationFeature = keyof typeof FEDERATION_FEATURES;

/** パス（id の形）。actor の id に handle を入れない（改名できるように）。 */
export const FEDERATION_PATHS = {
    wellKnownNodeInfo: '/.well-known/nodeinfo',
    nodeInfo: '/nodeinfo/2.1',
    appActor: '/ap/actor',
    sharedInbox: '/ap/inbox',
    user: (userId: string) => `/ap/users/${encodeURIComponent(userId)}`,
    userInbox: (userId: string) => `/ap/users/${encodeURIComponent(userId)}/inbox`,
    userOutbox: (userId: string) => `/ap/users/${encodeURIComponent(userId)}/outbox`,
    instance: (instanceId: string) => `/ap/instances/${encodeURIComponent(instanceId)}`,
    activity: (id: string) => `/ap/activities/${encodeURIComponent(id)}`,
    friendship: (id: string) => `/ap/friendships/${encodeURIComponent(id)}`,
    rpc: {
        join: '/federation/v1/rooms/join',
        grants: '/federation/v1/rooms/grants',
        visibility: '/federation/v1/rooms/visibility',
        presence: '/federation/v1/presence',
        friendshipCheck: '/federation/v1/friendships/check',
    },
} as const;

/** 鍵の id（actor の id + `#ed25519-<世代>`）。 */
export const keyIdOf = (actorId: string, generation = 1): string => `${actorId}#ed25519-${generation}`;

/** keyid から actor の id を取り出す（v1 は「actor の文書の中にある鍵」だけ）。 */
export function actorIdOfKey(keyId: string): string {
    const hash = keyId.indexOf('#');
    return hash < 0 ? keyId : keyId.slice(0, hash);
}

export const FEDERATION_LIMITS = {
    /** 受ける本文の上限（バイト） */
    INBOX_BODY_BYTES: 128 * 1024,
    RPC_BODY_BYTES: 16 * 1024,
    /** 取りに行く actor の文書の上限（バイト） */
    ACTOR_FETCH_BYTES: 256 * 1024,
    /** 受けた activity の id を覚える時間（2 度目を何もしない） */
    SEEN_ACTIVITY_MS: 7 * 24 * 60 * 60 * 1000,
    /** RPC の (keyid, nonce) を覚える時間 */
    NONCE_MS: 6 * 60 * 1000,
    /** actor の文書を、使ったときに裏で取り直すまでの時間 */
    ACTOR_FRESH_MS: 60 * 60 * 1000,
    /** actor の文書をキャッシュから使える最長の時間 */
    ACTOR_MAX_MS: 24 * 60 * 60 * 1000,
    /** 署名が通らなかったとき、鍵を取り直してよい間隔（actor ごと） */
    KEY_REFETCH_MS: 5 * 60 * 1000,
    /** フレンドの現在地の答えを使い回す時間（秒） */
    PRESENCE_TTL_SEC: 15,
    /** 来訪中の現在地の知らせの間隔と、途切れたら消すまでの時間 */
    VISIT_HEARTBEAT_MS: 30 * 1000,
    VISIT_STALE_MS: 90 * 1000,
    /** 1 度の問い合わせの数の上限 */
    MAX_PRESENCE_SUBJECTS: 100,
    MAX_VISIBILITY_VIEWERS: 50,
    MAX_GRANT_INVITEES: 20,
    /** 部屋の作り・入室 1 回で、中にいるほかのサーバーの人のホームへ尋ねるフレンドの確認の数 */
    MAX_FRIENDSHIP_CHECKS: 10,
    /** 受けたフレンド申請の上限（1 人あたり）と、失効までの時間 */
    MAX_PENDING_FRIEND_REQUESTS: 100,
    FRIEND_REQUEST_EXPIRE_MS: 30 * 24 * 60 * 60 * 1000,
    /** 断られたら、同じ 2 人の間で申請できない時間 */
    REJECT_COOLDOWN_MS: 7 * 24 * 60 * 60 * 1000,
    /** 取り消した activity の id を覚える時間（遅れて届いた申請を無視する） */
    UNDONE_MS: 14 * 24 * 60 * 60 * 1000,
    /** 1 つのドメインから同時に来られる来訪者の数（サーバー全体） */
    MAX_VISITORS_PER_DOMAIN: 20,
    /** 来訪者の表示名の上限（Go のチケットの名前と同じ） */
    VISITOR_NAME_MAX: 30,
} as const;

/** 部屋の作り（RPC と AS2 の Instance で共通）。人の一覧は返さず、人数だけ。 */
export interface RoomCard {
    /** 部屋の URL（`https://<domain>/ap/instances/<id>`） */
    id: string;
    /** ワールドの名前 */
    name: string;
    /** ワールドのサムネイル（https） */
    image: string | null;
    accessType: 'public' | 'friend_plus' | 'friend_only' | 'invite_only';
    members: number;
    capacity: number;
    /** 部屋を作った人の actor の id */
    leader: string;
    /** ワールドの正規 URL（読み込みは来訪者のサーバーが行う） */
    world: { url: string; name: string };
}
