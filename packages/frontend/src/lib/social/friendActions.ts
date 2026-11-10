import type { Friendship, RemoteRelation } from '@ubichill/shared';

export type FriendAction = 'request' | 'accept' | 'decline' | 'cancel' | 'unfriend';

export interface FriendActionView {
    action: FriendAction;
    label: string;
    tone: 'primary' | 'secondary' | 'danger';
    /** 取り返しのつく操作でも、相手との関係を消すものは確かめる */
    confirm?: string;
}

/** 相手との関係で出すボタン（自分には出さない。フレンドに対応していないサーバーの人には申請を出さない）。 */
export function friendActionsOf(
    friendship: Friendship,
    name: string,
    relation: RemoteRelation = {},
): FriendActionView[] {
    switch (friendship) {
        case 'none':
            return relation.friendsUnsupported ? [] : [{ action: 'request', label: 'フレンド申請', tone: 'primary' }];
        case 'outgoing':
            return [{ action: 'cancel', label: '申請を取り消す', tone: 'secondary' }];
        case 'incoming':
            return [
                { action: 'accept', label: '承認する', tone: 'primary' },
                { action: 'decline', label: '拒否', tone: 'secondary' },
            ];
        case 'friends':
            return [
                {
                    action: 'unfriend',
                    label: 'フレンド解除',
                    tone: 'danger',
                    confirm: `${name} さんとのフレンドを解除しますか？ 相手のフレンド一覧からも外れます。`,
                },
            ];
        default:
            return [];
    }
}

/** 操作したあとの関係（画面をすぐ変えるため。正はサーバーの応答）。 */
export function friendshipAfter(action: FriendAction): Friendship {
    if (action === 'request') return 'outgoing';
    if (action === 'accept') return 'friends';
    return 'none';
}

/** フェディバースでの関係（フォローされているか）。無ければ null。 */
export function followLabelOf(relation: RemoteRelation): string | null {
    if (relation.followsYou === 'accepted') return 'フォローされています';
    if (relation.followsYou === 'pending') return 'フォローリクエストが届いています';
    return null;
}

/** プロフィールのバナーの左上に出す、相手との関係（フォローされているか・フレンドか）。 */
export function relationBadgesOf(friendship: Friendship, relation: RemoteRelation): string[] {
    const follow = followLabelOf(relation);
    return [...(follow ? [follow] : []), ...(friendship === 'friends' ? ['フレンド'] : [])];
}

export type FollowerAction = 'approve' | 'reject' | 'remove';

export interface FollowerActionView {
    action: FollowerAction;
    label: string;
    tone: 'primary' | 'secondary' | 'danger';
    confirm?: string;
}

/** フォローしてきた人への操作（その人のプロフィールで行う）。承認待ちなら承認・拒否、フォロワーなら外す。 */
export function followerActionsOf(relation: RemoteRelation, name: string): FollowerActionView[] {
    if (relation.followsYou === 'pending') {
        return [
            { action: 'approve', label: 'フォローを承認', tone: 'primary' },
            { action: 'reject', label: '拒否', tone: 'secondary' },
        ];
    }
    if (relation.followsYou === 'accepted') {
        return [
            {
                action: 'remove',
                label: 'フォロワーから外す',
                tone: 'danger',
                confirm: `${name} さんをフォロワーから外しますか？ 相手には知らせずに外れます。`,
            },
        ];
    }
    return [];
}

/** フォロワーへの操作のあとの関係。 */
export function relationAfter(relation: RemoteRelation, action: FollowerAction): RemoteRelation {
    const { followsYou: _followsYou, ...rest } = relation;
    return action === 'approve' ? { ...rest, followsYou: 'accepted' } : rest;
}
