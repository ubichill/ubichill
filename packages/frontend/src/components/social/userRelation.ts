import type { Friendship, RemoteRelation, UserProfileWithFriendship } from '@ubichill/shared';

export interface UserRelation {
    friendship: Friendship;
    relation: RemoteRelation;
    /** 自分がこの人をブロックしている */
    blocked: boolean;
}

export type UserRelationSource = Pick<
    UserProfileWithFriendship,
    'id' | 'friendship' | 'friendsUnsupported' | 'followsYou' | 'blocked'
>;

/** プロフィールの取得結果（`GET /api/v1/social/users/:id`）から、自分との関係を取り出す。 */
export function userRelationOf(source: UserRelationSource): UserRelation {
    return {
        friendship: source.friendship,
        relation: {
            ...(source.friendsUnsupported ? { friendsUnsupported: true } : {}),
            ...(source.followsYou ? { followsYou: source.followsYou } : {}),
        },
        blocked: source.blocked === true,
    };
}

/** ブロックしたあとの関係: フレンドも申請も、フォローされているのも消える（backend がまとめて消す）。 */
export function relationAfterBlock(current: UserRelation): UserRelation {
    return {
        friendship: 'none',
        relation: current.relation.friendsUnsupported ? { friendsUnsupported: true } : {},
        blocked: true,
    };
}
