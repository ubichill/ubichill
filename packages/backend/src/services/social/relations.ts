/**
 * 見ている人（viewer）と相手との関係を 1 か所で集める: フレンド・ブロック・フォローされているか・フレンドに対応しない
 * サーバーか。プロフィール・検索・フレンドの操作はここから関係を引く（ばらばらに集めると食い違う）。
 * 規則は shared（friendshipOf・interactionRefusal）。相手はこのサーバーのユーザー ID か、ほかのサーバーの actor の URL。
 */
import type { RemoteActorRecord } from '@ubichill/db';
import {
    type BlockEdge,
    type FriendEdge,
    type Friendship,
    friendshipOf,
    type InteractionRefusal,
    interactionRefusal,
    type RemoteRelation,
    remoteProfileView,
    type StoredProfileFields,
    type UserProfile,
    type UserProfileWithFriendship,
    type UserSummary,
} from '@ubichill/shared';

export interface RelationDeps {
    friendEdgesOf(userId: string): Promise<FriendEdge[]>;
    /** ほかのサーバーの人との関係（このサーバーのフレンドと同じ語） */
    remoteFriendshipOf(userId: string, actorId: string): Promise<Friendship>;
    blocksBetween(a: string, b: string): Promise<BlockEdge[]>;
    /** フェディバースでこの actor が userId をフォローしているか（pending は承認待ち） */
    followOf(userId: string, actorId: string): Promise<'accepted' | 'pending' | undefined>;
    /** そのドメインがフレンドに対応していないと分かっているか（分からなければ false） */
    lacksFriends(domain: string): Promise<boolean>;
    /** 公開プロフィール（ロール込み） */
    publicProfileOf(user: StoredProfileFields): Promise<UserProfile>;
    remoteSummaryOf(actor: RemoteActorRecord): UserSummary;
}

/** 見ている人から見た相手との関係（プロフィール・検索の結果に重ねる）。 */
export interface Relation extends RemoteRelation {
    friendship: Friendship;
    /** 見ている人がこの人をブロックしている */
    blocked?: true;
}

const blockedFlag = (refusal: InteractionRefusal | null): { blocked?: true } =>
    refusal === 'blocking' ? { blocked: true } : {};

export function createRelations(deps: RelationDeps) {
    /** from が to に何かをしてよいか（自分自身・ブロック）。 */
    const interaction = async (fromId: string, toId: string): Promise<InteractionRefusal | null> =>
        fromId === toId ? 'self' : interactionRefusal(fromId, toId, await deps.blocksBetween(fromId, toId));

    /** ほかのサーバーの人だけの関係（フレンドに対応しないサーバーか・フォローされているか）。 */
    const remoteOnly = async (viewerId: string | undefined, actor: RemoteActorRecord): Promise<RemoteRelation> => {
        const [unsupported, follow] = await Promise.all([
            deps.lacksFriends(actor.domain),
            viewerId ? deps.followOf(viewerId, actor.id) : undefined,
        ]);
        return { ...(unsupported ? { friendsUnsupported: true } : {}), ...(follow ? { followsYou: follow } : {}) };
    };

    const ofLocal = async (viewerId: string | undefined, targetId: string): Promise<Relation> => {
        if (!viewerId) return { friendship: 'none' };
        const [edges, refusal] = await Promise.all([deps.friendEdgesOf(viewerId), interaction(viewerId, targetId)]);
        return { friendship: friendshipOf(edges, viewerId, targetId), ...blockedFlag(refusal) };
    };

    const ofRemote = async (viewerId: string | undefined, actor: RemoteActorRecord): Promise<Relation> => {
        const [remote, friendship, refusal] = await Promise.all([
            remoteOnly(viewerId, actor),
            viewerId ? deps.remoteFriendshipOf(viewerId, actor.id) : ('none' as const),
            viewerId ? interaction(viewerId, actor.id) : null,
        ]);
        return { ...remote, friendship, ...blockedFlag(refusal) };
    };

    return {
        interaction,
        ofLocal,
        ofRemote,

        /** 一覧（検索）向け: viewer のフレンドの行を 1 回だけ引き、相手ごとの関係を返す関数にする。 */
        async friendshipLookup(viewerId: string): Promise<(otherId: string) => Friendship> {
            const edges = await deps.friendEdgesOf(viewerId);
            return (otherId) => friendshipOf(edges, viewerId, otherId);
        },

        /** このサーバーの人のプロフィールと自分との関係（ユーザーページとリンクのプレビュー）。 */
        async localProfile(
            viewerId: string | undefined,
            user: StoredProfileFields,
        ): Promise<UserProfileWithFriendship> {
            const [profile, relation] = await Promise.all([deps.publicProfileOf(user), ofLocal(viewerId, user.id)]);
            return { ...profile, ...relation };
        },

        /** ほかのサーバーの人のプロフィール（バナー・項目の表は取りに行った actor の文書から）と自分との関係。 */
        async remoteProfile(
            viewerId: string | undefined,
            actor: RemoteActorRecord,
        ): Promise<UserProfileWithFriendship> {
            const { fields, bioSegments, emojis: _emojis, ...profile } = remoteProfileView(actor.profile);
            const relation = await ofRemote(viewerId, actor);
            return {
                ...deps.remoteSummaryOf(actor),
                author: actor.account,
                bannerImage: actor.banner,
                ...profile,
                roles: [],
                ...(fields.length > 0 ? { fields } : {}),
                ...(bioSegments && bioSegments.length > 0 ? { bioSegments } : {}),
                ...relation,
            };
        },
    };
}

export type Relations = ReturnType<typeof createRelations>;
