import { describe, expect, it } from 'vitest';
import {
    followerActionsOf,
    followLabelOf,
    friendActionsOf,
    friendshipAfter,
    relationAfter,
    relationBadgesOf,
} from './friendActions';

describe('friendActionsOf', () => {
    it('関係ごとに出す操作を決める', () => {
        expect(friendActionsOf('none', 'A').map((a) => a.action)).toEqual(['request']);
        expect(friendActionsOf('outgoing', 'A').map((a) => a.action)).toEqual(['cancel']);
        expect(friendActionsOf('incoming', 'A').map((a) => a.action)).toEqual(['accept', 'decline']);
        expect(friendActionsOf('friends', 'A').map((a) => a.action)).toEqual(['unfriend']);
    });

    it('自分には何も出さない', () => {
        expect(friendActionsOf('self', 'A')).toEqual([]);
    });

    it('フレンド解除だけ確かめる（相手の一覧からも外れるため）', () => {
        expect(friendActionsOf('friends', 'ようかん')[0]?.confirm).toContain('ようかん');
        expect(friendActionsOf('none', 'A')[0]?.confirm).toBeUndefined();
    });
});

describe('フレンドに対応していないサーバーの人（Misskey・Mastodon など）', () => {
    it('申請は出さない（送っても相手のサーバーが受けられない）。フォローされているかを代わりに出す', () => {
        expect(friendActionsOf('none', 'A', { friendsUnsupported: true })).toEqual([]);
        expect(followLabelOf({ friendsUnsupported: true, followsYou: 'accepted' })).toBe('フォローされています');
        expect(followLabelOf({ followsYou: 'pending' })).toBe('フォローリクエストが届いています');
        expect(followLabelOf({})).toBeNull();
    });

    it('フレンドの関係が既にあれば（あとから対応をやめたサーバー）、解除・取り消しは出す', () => {
        expect(friendActionsOf('friends', 'A', { friendsUnsupported: true }).map((a) => a.action)).toEqual([
            'unfriend',
        ]);
        expect(friendActionsOf('outgoing', 'A', { friendsUnsupported: true }).map((a) => a.action)).toEqual(['cancel']);
    });
});

describe('friendshipAfter', () => {
    it('申請すると申請中、承認するとフレンド、ほかは関係なし', () => {
        expect(friendshipAfter('request')).toBe('outgoing');
        expect(friendshipAfter('accept')).toBe('friends');
        expect(friendshipAfter('decline')).toBe('none');
        expect(friendshipAfter('unfriend')).toBe('none');
    });
});

describe('プロフィールでのフォロワーへの操作', () => {
    it('承認待ちは承認・拒否、フォロワーは外す（確かめる）、フォローされていなければ何も出さない', () => {
        expect(followerActionsOf({ followsYou: 'pending' }, 'A').map((a) => a.action)).toEqual(['approve', 'reject']);
        const [remove] = followerActionsOf({ followsYou: 'accepted', friendsUnsupported: true }, 'A');
        expect(remove?.action).toBe('remove');
        expect(remove?.confirm).toContain('A さん');
        expect(followerActionsOf({ friendsUnsupported: true }, 'A')).toEqual([]);
    });

    it('承認するとフォロワー、拒否・外すとフォローの関係が消える（フレンドに対応しているかは残す）', () => {
        expect(relationAfter({ followsYou: 'pending', friendsUnsupported: true }, 'approve')).toEqual({
            followsYou: 'accepted',
            friendsUnsupported: true,
        });
        expect(relationAfter({ followsYou: 'pending', friendsUnsupported: true }, 'reject')).toEqual({
            friendsUnsupported: true,
        });
        expect(relationAfter({ followsYou: 'accepted' }, 'remove')).toEqual({});
    });

    it('バナーの左上の札: フォローされているか（承認待ちも）とフレンド。どちらも無ければ空', () => {
        expect(relationBadgesOf('friends', { followsYou: 'accepted' })).toEqual(['フォローされています', 'フレンド']);
        expect(relationBadgesOf('outgoing', { followsYou: 'pending' })).toEqual(['フォローリクエストが届いています']);
        expect(relationBadgesOf('none', {})).toEqual([]);
    });
});
