import { describe, expect, it } from 'vitest';
import { type ProfileRelationInput, profileActionsOf } from './profileActions';

const input = (over: Partial<ProfileRelationInput> = {}): ProfileRelationInput => ({
    user: { id: 'bob', name: 'Bob' },
    viewerId: 'me',
    friendship: 'none',
    relation: {},
    blocked: false,
    inLaunchpad: true,
    ...over,
});

const kinds = (over: Partial<ProfileRelationInput> = {}) =>
    profileActionsOf(input(over)).actions.map((a) =>
        a.kind === 'block' ? `block:${a.block}` : a.kind === 'message' ? 'message' : `${a.kind}:${a.action}`,
    );

describe('profileActionsOf', () => {
    it('知らない人: 札は無く、フレンド申請とブロック', () => {
        expect(profileActionsOf(input()).badges).toEqual([]);
        expect(kinds()).toEqual(['friend:request', 'block:true']);
    });

    it('フレンド: 札は「フレンド」、メッセージ・解除・ブロックの順', () => {
        expect(profileActionsOf(input({ friendship: 'friends' })).badges).toEqual(['フレンド']);
        expect(kinds({ friendship: 'friends' })).toEqual(['message', 'friend:unfriend', 'block:true']);
    });

    it('メッセージはランチパッドの中だけ・ログインしているときだけ', () => {
        expect(kinds({ friendship: 'friends', inLaunchpad: false })).not.toContain('message');
        expect(kinds({ friendship: 'friends', viewerId: null })).not.toContain('message');
    });

    it('ほかのサーバーのフレンドにはメッセージを出さない（メッセージはこのサーバーの中だけ）', () => {
        expect(kinds({ friendship: 'friends', user: { id: 'https://misskey.example/users/b', name: 'B' } })).toEqual([
            'friend:unfriend',
            'block:true',
        ]);
    });

    it('フォローの承認待ちとフレンド申請が同時に来ている: フォロワーへの操作が先、フレンドが後', () => {
        const view = profileActionsOf(input({ friendship: 'incoming', relation: { followsYou: 'pending' } }));
        expect(view.badges).toEqual(['フォローリクエストが届いています']);
        expect(kinds({ friendship: 'incoming', relation: { followsYou: 'pending' } })).toEqual([
            'follower:approve',
            'follower:reject',
            'friend:accept',
            'friend:decline',
            'block:true',
        ]);
    });

    it('フレンドに対応していないサーバーのフォロワー: フォロワーから外す（確かめる）とブロックだけ', () => {
        const view = profileActionsOf(input({ relation: { friendsUnsupported: true, followsYou: 'accepted' } }));
        expect(view.badges).toEqual(['フォローされています']);
        expect(view.actions.map((a) => a.label)).toEqual(['フォロワーから外す', 'ブロック']);
        expect(view.actions[0]?.kind === 'follower' && view.actions[0].confirm).toContain('Bob');
    });

    it('ブロック中: フレンドでもフォロワーでも、札は「ブロック中」、操作は解除だけ（解除は確かめない）', () => {
        const view = profileActionsOf(
            input({ blocked: true, friendship: 'friends', relation: { followsYou: 'accepted' } }),
        );
        expect(view.badges).toEqual(['ブロック中']);
        expect(view.actions).toEqual([{ kind: 'block', block: false, label: 'ブロックを解除', tone: 'secondary' }]);
    });

    it('ブロックは名前を出して確かめる', () => {
        const block = profileActionsOf(input()).actions.at(-1);
        expect(block?.kind === 'block' && block.confirm).toContain('Bob をブロックしますか');
    });

    it('自分には何も出さない', () => {
        expect(profileActionsOf(input({ friendship: 'self' }))).toEqual({ badges: [], actions: [] });
    });
});
