import type { Friendship } from '@ubichill/shared';

export type FriendAction = 'request' | 'accept' | 'decline' | 'cancel' | 'unfriend';

export interface FriendActionView {
    action: FriendAction;
    label: string;
    tone: 'primary' | 'secondary' | 'danger';
    /** 取り返しのつく操作でも、相手との関係を消すものは確かめる */
    confirm?: string;
}

/** 相手との関係で出すボタン（自分には出さない）。 */
export function friendActionsOf(friendship: Friendship, name: string): FriendActionView[] {
    switch (friendship) {
        case 'none':
            return [{ action: 'request', label: 'フレンド申請', tone: 'primary' }];
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
