import type { RemoteActorRecord } from '@ubichill/db';
import { FEDERATION_LIMITS, type FriendshipCheckResponse } from '@ubichill/shared';
import { describe, expect, it, vi } from 'vitest';

interface Row {
    userId: string;
    actorId: string;
    state: 'accepted' | 'outgoing' | 'incoming' | 'rejected';
    checkedAt: Date | null;
}

const { db, none } = vi.hoisted(() => ({ db: { rows: [] as Row[] }, none: async () => [] }));

vi.mock('@ubichill/db', () => ({
    domainPolicyRepository: { list: none },
    federationSeenRepository: { deleteExpired: async () => undefined },
    followerRepository: { removeForDeletedActors: none, removeForDomain: none },
    remoteVisitRepository: { deleteStale: async () => undefined },
    remoteFriendshipRepository: {
        removeForDeletedActors: none,
        removeForDomain: none,
        deleteStale: async () => undefined,
        // checked_at ASC NULLS FIRST LIMIT n（remoteFriendshipRepository.dueForCheck と同じ並び）
        dueForCheck: async (before: Date, limit: number) =>
            db.rows
                .filter((r) => r.state !== 'rejected' && (!r.checkedAt || r.checkedAt < before))
                .sort((a, b) => (a.checkedAt?.getTime() ?? -1) - (b.checkedAt?.getTime() ?? -1))
                .slice(0, limit),
        markChecked: async (userId: string, actorId: string, at: Date) => {
            for (const r of db.rows) if (r.userId === userId && r.actorId === actorId) r.checkedAt = at;
        },
    },
}));
vi.mock('../notifications/notificationService', () => ({ notificationService: {} }));
vi.mock('../../utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { createFederationIdentity } from './identity';
import { createFederationMaintenance } from './maintenance';

const identity = createFederationIdentity('https://a.example');
const T0 = new Date('2026-11-07T00:00:00Z');
const SWEEP_MS = 10 * 60 * 1000;

const actorRecord = (id: string): RemoteActorRecord => ({
    id,
    account: `${id.split('/').pop()}@${new URL(id).host}`,
    domain: new URL(id).host,
    type: 'Person',
    name: null,
    summary: null,
    icon: null,
    banner: null,
    profile: {},
    url: null,
    inbox: `${id}/inbox`,
    sharedInbox: null,
    keys: [],
    features: [],
    fetchedAt: T0,
    deletedAt: null,
    createdAt: T0,
});

function setup(options: { failReconcile?: string } = {}) {
    const asked: string[] = [];
    const logs: string[] = [];
    const maintenance = createFederationMaintenance({
        identity,
        actors: { get: async (id) => (id.includes('unknown.example') ? null : actorRecord(id)) },
        friendships: {
            reconcile: async (_userId, actor) => {
                if (actor.id === options.failReconcile) throw new Error('DB が落ちた');
                return 'kept';
            },
        },
        friendshipCheck: {
            // 落ちたサーバーは答えない
            relationOf: async (member): Promise<FriendshipCheckResponse | null> => {
                asked.push(member);
                return member.includes('down.example') ? null : { friends: true, state: 'friends' };
            },
        },
        lacks: async () => false,
        log: (message) => void logs.push(message),
    });
    return { maintenance, asked, logs };
}

const actorsOn = (host: string, count: number) =>
    Array.from({ length: count }, (_, i) => `https://${host}/ap/users/u${i}`);

describe('フレンドの関係を確かめ直す（掃除）', () => {
    it('落ちたサーバーの関係が先頭に並んでも、次の掃除では生きている相手を確かめる（失敗しても次は 1 日後）', async () => {
        const down = actorsOn('down.example', FEDERATION_LIMITS.FRIENDSHIP_RECHECK_BATCH);
        db.rows = [
            ...down.map((actorId): Row => ({ userId: 'alice', actorId, state: 'accepted', checkedAt: null })),
            {
                userId: 'alice',
                actorId: 'https://up.example/ap/users/bob',
                state: 'accepted',
                checkedAt: new Date(T0.getTime() - 2 * FEDERATION_LIMITS.FRIENDSHIP_RECHECK_MS),
            },
        ];
        const { maintenance, asked } = setup();
        await maintenance.sweep(T0);
        expect(asked).toEqual(down);
        await maintenance.sweep(new Date(T0.getTime() + SWEEP_MS));
        expect(asked.slice(down.length)).toEqual(['https://up.example/ap/users/bob']);
        // 1 日たつまでは、落ちたサーバーにも尋ね直さない
        await maintenance.sweep(new Date(T0.getTime() + 2 * SWEEP_MS));
        expect(asked).toHaveLength(down.length + 1);
        await maintenance.sweep(new Date(T0.getTime() + FEDERATION_LIMITS.FRIENDSHIP_RECHECK_MS + SWEEP_MS));
        expect(asked).toHaveLength(2 * down.length + 1);
    });

    it('actor を引けない・1 件の照らし合わせが投げても、残りを確かめ、どれも次は 1 日後', async () => {
        db.rows = [
            { userId: 'alice', actorId: 'https://unknown.example/ap/users/x', state: 'outgoing', checkedAt: null },
            { userId: 'alice', actorId: 'https://up.example/ap/users/broken', state: 'accepted', checkedAt: null },
            { userId: 'alice', actorId: 'https://up.example/ap/users/bob', state: 'incoming', checkedAt: null },
        ];
        const { maintenance, asked, logs } = setup({ failReconcile: 'https://up.example/ap/users/broken' });
        await maintenance.sweep(T0);
        expect(asked).toEqual(['https://up.example/ap/users/broken', 'https://up.example/ap/users/bob']);
        expect(db.rows.map((r) => r.checkedAt)).toEqual([T0, T0, T0]);
        expect(logs.some((l) => l.includes('broken'))).toBe(true);
    });
});
