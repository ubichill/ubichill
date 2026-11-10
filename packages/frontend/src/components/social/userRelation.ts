import type { Friendship, RemoteRelation, UserProfileWithFriendship } from '@ubichill/shared';

export interface UserRelation {
    friendship: Friendship;
    relation: RemoteRelation;
}

export type UserRelationSource = Pick<
    UserProfileWithFriendship,
    'id' | 'friendship' | 'friendsUnsupported' | 'followsYou'
>;

/** プロフィールの取得結果（`GET /api/v1/social/users/:id`）から、自分との関係を取り出す。 */
export function userRelationOf(source: UserRelationSource): UserRelation {
    return {
        friendship: source.friendship,
        relation: {
            ...(source.friendsUnsupported ? { friendsUnsupported: true } : {}),
            ...(source.followsYou ? { followsYou: source.followsYou } : {}),
        },
    };
}
