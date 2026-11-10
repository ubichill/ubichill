import type { RemoteActorRecord } from '@ubichill/db';
import type { BlockEdge, FriendEdge, StoredProfileFields, UserProfile } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import { createRelations, type RelationDeps } from './relations';

const ACTOR = 'https://b.example/users/bob';

const actor = {
    id: ACTOR,
    domain: 'b.example',
    account: 'bob@b.example',
    banner: null,
    profile: {},
} as unknown as RemoteActorRecord;

function setup(options: { blocks?: BlockEdge[]; edges?: FriendEdge[]; lacks?: boolean } = {}) {
    const calls: string[] = [];
    const deps: RelationDeps = {
        friendEdgesOf: async (userId) => {
            calls.push(`edges:${userId}`);
            return options.edges ?? [];
        },
        remoteFriendshipOf: async () => 'incoming',
        blocksBetween: async () => options.blocks ?? [],
        followOf: async () => 'pending',
        lacksFriends: async () => options.lacks ?? false,
        publicProfileOf: async (user) => ({ id: user.id, roles: [] }) as unknown as UserProfile,
        remoteSummaryOf: (a) => ({ id: a.id, name: 'Bob', handle: a.account, image: null, bio: null }),
    };
    return { relations: createRelations(deps), calls };
}

const user = { id: 'bob' } as StoredProfileFields;

describe('relations', () => {
    it('自分自身は self。ブロックの行を引かずに決める', async () => {
        const { relations } = setup({ blocks: [{ blockerId: 'alice', blockedId: 'alice' }] });
        expect(await relations.interaction('alice', 'alice')).toBe('self');
    });

    it('見ている人がブロックしているときだけ blocked を付ける（ブロックされた側には明かさない）', async () => {
        const { relations } = setup({ blocks: [{ blockerId: 'alice', blockedId: 'bob' }] });
        expect(await relations.ofLocal('alice', 'bob')).toEqual({ friendship: 'none', blocked: true });
        expect(await relations.ofLocal('bob', 'alice')).toEqual({ friendship: 'none' });
    });

    it('ログインしていなければ関係は none だけで、フレンドの行も引かない', async () => {
        const { relations, calls } = setup({ edges: [{ userId: 'alice', friendId: 'bob', status: 'accepted' }] });
        expect(await relations.ofLocal(undefined, 'bob')).toEqual({ friendship: 'none' });
        expect(calls).toEqual([]);
    });

    it('プロフィールは公開プロフィールに関係を重ねる', async () => {
        const { relations } = setup({ edges: [{ userId: 'bob', friendId: 'alice', status: 'pending' }] });
        expect(await relations.localProfile('alice', user)).toEqual({ id: 'bob', roles: [], friendship: 'incoming' });
    });

    it('ほかのサーバーの人: 非対応のサーバー・フォロー・連合のフレンドの関係を集める', async () => {
        const { relations } = setup({ lacks: true });
        expect(await relations.ofRemote('alice', actor)).toEqual({
            friendsUnsupported: true,
            followsYou: 'pending',
            friendship: 'incoming',
        });
    });

    it('ログインしていなくても、フレンドに対応しないサーバーかは出す（申請のボタンを出さないため）', async () => {
        const { relations } = setup({ lacks: true });
        expect(await relations.ofRemote(undefined, actor)).toEqual({ friendsUnsupported: true, friendship: 'none' });
    });

    it('ほかのサーバーの人のプロフィールはロールを持たず、作者アカウントは actor のアカウント', async () => {
        const { relations } = setup({ blocks: [{ blockerId: 'alice', blockedId: ACTOR }] });
        const profile = await relations.remoteProfile('alice', actor);
        expect(profile).toMatchObject({ id: ACTOR, author: 'bob@b.example', roles: [], blocked: true });
    });

    it('一覧向けの関係はフレンドの行を 1 回だけ引く', async () => {
        const { relations, calls } = setup({ edges: [{ userId: 'alice', friendId: 'bob', status: 'accepted' }] });
        const of = await relations.friendshipLookup('alice');
        expect([of('bob'), of('carol'), of('alice')]).toEqual(['friends', 'none', 'self']);
        expect(calls).toEqual(['edges:alice']);
    });
});
