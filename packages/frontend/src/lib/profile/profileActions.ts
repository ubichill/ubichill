/**
 * ほかの人のプロフィールのバナーに出すもの（自分との関係 → 左上の札と右上の操作）。実行は components/profile/useProfileRelation.ts。
 */
import { type Friendship, messageRefusal, type RemoteRelation } from '@ubichill/shared';
import {
    type FollowerAction,
    type FriendAction,
    followerActionsOf,
    friendActionsOf,
    relationBadgesOf,
} from '../social/friendActions';

type Tone = 'primary' | 'secondary' | 'danger';

export type ProfileAction =
    | { kind: 'follower'; action: FollowerAction; label: string; tone: Tone; confirm?: string }
    | { kind: 'message'; label: string; tone: Tone }
    | { kind: 'friend'; action: FriendAction; label: string; tone: Tone; confirm?: string }
    | { kind: 'block'; block: boolean; label: string; tone: Tone; confirm?: string };

export interface ProfileRelationInput {
    user: { id: string; name: string };
    /** ログインしている自分（未ログインなら null） */
    viewerId: string | null;
    friendship: Friendship;
    relation: RemoteRelation;
    blocked: boolean;
    /** 会話はランチパッドに重ねて開くので、ランチパッドの外のページでは「メッセージ」を出さない */
    inLaunchpad: boolean;
}

export interface ProfileRelationView {
    badges: string[];
    /** 並び順どおり。自分のプロフィールでは空 */
    actions: ProfileAction[];
}

/** ブロック中は「ブロック中」の札と解除だけ。そうでなければフォロワーへの操作・メッセージ・フレンドの操作・ブロックの順。 */
export function profileActionsOf(input: ProfileRelationInput): ProfileRelationView {
    const { user, viewerId, friendship, relation, blocked } = input;
    if (friendship === 'self') return { badges: [], actions: [] };
    if (blocked) {
        return {
            badges: ['ブロック中'],
            actions: [{ kind: 'block', block: false, label: 'ブロックを解除', tone: 'secondary' }],
        };
    }
    const canMessage =
        input.inLaunchpad &&
        viewerId !== null &&
        messageRefusal(viewerId, user.id, { friends: friendship === 'friends', blocked }) === null;
    return {
        badges: relationBadgesOf(friendship, relation),
        actions: [
            ...followerActionsOf(relation, user.name).map((a): ProfileAction => ({ kind: 'follower', ...a })),
            ...(canMessage ? [{ kind: 'message', label: 'メッセージ', tone: 'primary' } as const] : []),
            ...friendActionsOf(friendship, user.name, relation).map((a): ProfileAction => ({ kind: 'friend', ...a })),
            {
                kind: 'block',
                block: true,
                label: 'ブロック',
                tone: 'danger',
                confirm: `${user.name} をブロックしますか？フレンドと申請は消え、この人は見えなくなり、この人が作った mod は読み込まなくなります。`,
            },
        ],
    };
}
