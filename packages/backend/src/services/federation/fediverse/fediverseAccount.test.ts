import type { FollowerWithActor } from '@ubichill/db';
import { DEFAULT_FEDIVERSE_SETTINGS } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import { createFediverseAccount, type FediverseAccountDeps } from './fediverseAccount';

const rowOf = (actorId: string, state: 'pending' | 'accepted', profile: unknown = {}): FollowerWithActor => ({
    userId: 'u1',
    actorId,
    state,
    followId: `${actorId}#follow`,
    createdAt: new Date('2026-11-01T00:00:00Z'),
    updatedAt: new Date('2026-11-02T00:00:00Z'),
    account: `${actorId.split('/').pop()}@m.example`,
    name: null,
    icon: null,
    url: null,
    profile: profile as FollowerWithActor['profile'],
});

function setup(
    options: { federated?: boolean; rows?: FollowerWithActor[]; resolvable?: boolean; answer?: boolean } = {},
) {
    const rows = options.rows ?? [];
    const calls: string[] = [];
    const deps: FediverseAccountDeps = {
        findUser: async (id) => (id === 'u1' ? { handle: 'alice' } : undefined),
        accountOf: (handle) => `${handle}@a.example`,
        settingsOf: async () => DEFAULT_FEDIVERSE_SETTINGS,
        updateSettings: async (_userId, changes) => ({ ...DEFAULT_FEDIVERSE_SETTINGS, ...changes }),
        followers: {
            get: async (userId, actorId) => rows.find((r) => r.userId === userId && r.actorId === actorId),
            listForUser: async (userId, state) => rows.filter((r) => r.userId === userId && r.state === state),
            countAccepted: async (userId) => rows.filter((r) => r.userId === userId && r.state === 'accepted').length,
        },
        federation:
            options.federated === false
                ? null
                : {
                      actorOf: async (actorId) =>
                          options.resolvable === false ? null : { id: actorId, inbox: `${actorId}/inbox` },
                      approve: async (_userId, actor) => {
                          calls.push(`approve ${actor.id}`);
                          return options.answer ?? true;
                      },
                      reject: async (_userId, actor) => {
                          calls.push(`reject ${actor.id}`);
                          return options.answer === false ? 'absent' : 'rejected';
                      },
                  },
    };
    return { account: createFediverseAccount(deps), calls };
}

describe('createFediverseAccount', () => {
    it('概要: 承認待ちとフォロワーを分け、数は承認済みだけ。名前の絵文字は形を確かめたものだけ付ける', async () => {
        const { account } = setup({
            rows: [
                rowOf('https://m.example/users/a', 'pending'),
                rowOf('https://m.example/users/b', 'accepted', { emojis: 'broken' }),
                rowOf('https://m.example/users/c', 'accepted'),
            ],
        });
        const overview = await account.overview('u1');
        expect(overview).toMatchObject({ enabled: true, account: 'alice@a.example', followerCount: 2 });
        expect(overview?.pending.map((f) => f.actorId)).toEqual(['https://m.example/users/a']);
        expect(overview?.followers.every((f) => !('emojis' in f))).toBe(true);
        expect(await account.overview('ghost')).toBeNull();
    });

    it('連合していないサーバーでも概要は返す（enabled: false）が、承認・断るはできない', async () => {
        const { account } = setup({ federated: false, rows: [rowOf('https://m.example/users/a', 'pending')] });
        expect((await account.overview('u1'))?.enabled).toBe(false);
        expect(await account.answerFollower('u1', 'https://m.example/users/a', 'approve')).toBe('not-federated');
    });

    it('承認・断る: フォロワーでない人・引けない actor には何も送らない', async () => {
        const stranger = setup({ rows: [] });
        expect(await stranger.account.answerFollower('u1', 'https://m.example/users/x', 'reject')).toBe('not-found');
        expect(stranger.calls).toEqual([]);
        const unresolvable = setup({ rows: [rowOf('https://m.example/users/a', 'pending')], resolvable: false });
        expect(await unresolvable.account.answerFollower('u1', 'https://m.example/users/a', 'approve')).toBe(
            'not-found',
        );
        expect(unresolvable.calls).toEqual([]);
    });

    it('承認・断る: 他人のフォロワーは操作できない', async () => {
        const { account, calls } = setup({
            rows: [{ ...rowOf('https://m.example/users/a', 'pending'), userId: 'u2' }],
        });
        expect(await account.answerFollower('u1', 'https://m.example/users/a', 'approve')).toBe('not-found');
        expect(calls).toEqual([]);
    });

    it('承認・断る: 承認待ちでなければ not-pending（同時に取り消された場合）', async () => {
        const { account, calls } = setup({ rows: [rowOf('https://m.example/users/a', 'pending')], answer: false });
        expect(await account.answerFollower('u1', 'https://m.example/users/a', 'approve')).toBe('not-pending');
        expect(await account.answerFollower('u1', 'https://m.example/users/a', 'reject')).toBe('not-pending');
        expect(calls).toEqual(['approve https://m.example/users/a', 'reject https://m.example/users/a']);
    });
});
