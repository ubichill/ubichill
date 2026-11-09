import type { FollowerRecord } from '@ubichill/db';
import {
    DEFAULT_FEDIVERSE_SETTINGS,
    type DomainPolicy,
    FEDIVERSE_LIMITS,
    type FediverseSettings,
} from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import { createFollows, type FollowActor } from './follows';
import { createFederationIdentity } from './identity';

const identity = createFederationIdentity('https://a.example');
const ALICE_URL = identity.actorUrl('alice');
const MISSKEY: FollowActor = {
    id: 'https://misskey.example/users/9x',
    inbox: 'https://misskey.example/users/9x/inbox',
    domain: 'misskey.example',
};
const follow = (id = 'https://misskey.example/follows/9x/alice', object = ALICE_URL) => ({ id, object });

function setup(options: { manual?: boolean; policy?: DomainPolicy; failSend?: boolean } = {}) {
    const rows: FollowerRecord[] = [];
    const sent: Array<{ inbox: string; activity: Record<string, unknown> }> = [];
    const notes: string[] = [];
    const settings = new Map<string, FediverseSettings>([
        ['alice', { ...DEFAULT_FEDIVERSE_SETTINGS, manuallyApprovesFollowers: !!options.manual }],
    ]);
    const find = (userId: string, actorId: string) => rows.find((r) => r.userId === userId && r.actorId === actorId);
    const locks = new Map<string, Promise<void>>();
    const seen = new Set<string>();
    const follows = createFollows({
        identity,
        repo: {
            // 2 人ごとに順番に実行する（DB の advisory lock の代わり）。投げたら行を戻す（トランザクションの代わり）
            locked: (userId, actorId, fn) => {
                const k = `${userId}|${actorId}`;
                const run = (locks.get(k) ?? Promise.resolve()).then(async () => {
                    const current = find(userId, actorId);
                    await new Promise((r) => setTimeout(r, 0));
                    const before = rows.map((r) => ({ ...r }));
                    const outgoing: typeof sent = [];
                    return fn(current, {
                        put: async (input, now) => {
                            const existing = find(userId, actorId);
                            const row: FollowerRecord = {
                                userId,
                                actorId,
                                ...input,
                                createdAt: existing?.createdAt ?? now,
                                updatedAt: now,
                            };
                            if (existing) rows.splice(rows.indexOf(existing), 1, row);
                            else rows.push(row);
                            return row;
                        },
                        remove: async () => {
                            const row = find(userId, actorId);
                            if (row) rows.splice(rows.indexOf(row), 1);
                        },
                        countPending: async () =>
                            rows.filter((r) => r.userId === userId && r.state === 'pending').length,
                        enqueue: async (delivery) => {
                            if (options.failSend) throw new Error('送る予定に入れられない');
                            outgoing.push({
                                inbox: delivery.inbox,
                                activity: delivery.body as Record<string, unknown>,
                            });
                        },
                    }).then(
                        (result) => {
                            sent.push(...outgoing);
                            return result;
                        },
                        (error: unknown) => {
                            rows.splice(0, rows.length, ...before);
                            throw error;
                        },
                    );
                });
                locks.set(
                    k,
                    run.then(
                        () => undefined,
                        () => undefined,
                    ),
                );
                return run;
            },
            findByFollowId: async (followId) => rows.filter((r) => r.followId === followId),
            pendingActorIdsOf: async (userId) =>
                rows.filter((r) => r.userId === userId && r.state === 'pending').map((r) => r.actorId),
            removeAllFor: async (actorId) => {
                const hit = rows.filter((r) => r.actorId === actorId);
                for (const r of hit) rows.splice(rows.indexOf(r), 1);
                return hit;
            },
        },
        userExists: async (userId) => userId === 'alice' || userId.startsWith('user'),
        settingsOf: async (userId) =>
            settings.get(userId) ?? { ...DEFAULT_FEDIVERSE_SETTINGS, manuallyApprovesFollowers: !!options.manual },
        actorOf: async (actorId) => ({
            id: actorId,
            inbox: `${actorId}/inbox`,
            domain: new URL(actorId).host,
        }),
        outbox: {
            prepare: (message) => ({
                id: message.activity.id,
                senderUserId: message.from.kind === 'user' ? message.from.userId : null,
                inbox: message.to.inbox,
                host: new URL(message.to.inbox).host,
                body: message.activity,
                orderKey: message.to.id,
                deadlineAt: new Date(0),
            }),
        },
        notify: {
            fediverseFollowed: async (actor, user) => void notes.push(`followed ${actor} → ${user}`),
            fediverseFollowRequested: async (actor, user) => void notes.push(`requested ${actor} → ${user}`),
            fediverseFollowSettled: async (user, actor) => void notes.push(`settled ${user} ← ${actor}`),
        },
        seen: {
            remember: async (key) => {
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            },
            has: async (key) => seen.has(key),
        },
        policyOf: () => options.policy ?? 'allow',
        now: () => Date.parse('2026-11-09T00:00:00Z'),
    });
    return { follows, rows, sent, notes, settings };
}

/** 送った activity の型と、埋め込んだ Follow。 */
const answers = (sent: ReturnType<typeof setup>['sent']) =>
    sent.map((s) => ({ type: s.activity.type, to: s.inbox, follow: s.activity.object }));

describe('フェディバースからのフォロー', () => {
    it('承認制でなければすぐ承認し、受けた Follow を埋め込んだ Accept を相手の個人の inbox へ送る', async () => {
        const { follows, rows, sent, notes } = setup();
        await follows.onFollow(MISSKEY, follow());
        expect(rows).toMatchObject([{ userId: 'alice', actorId: MISSKEY.id, state: 'accepted' }]);
        expect(answers(sent)).toEqual([
            {
                type: 'Accept',
                to: MISSKEY.inbox,
                follow: { id: follow().id, type: 'Follow', actor: MISSKEY.id, object: ALICE_URL },
            },
        ]);
        expect(sent[0]?.activity.actor).toBe(ALICE_URL);
        expect(notes).toEqual([`followed ${MISSKEY.id} → alice`]);
    });

    it('承認制なら承認待ちにして知らせ、承認したら Accept を送って知らせを片付ける', async () => {
        const { follows, rows, sent, notes } = setup({ manual: true });
        await follows.onFollow(MISSKEY, follow());
        expect(rows).toMatchObject([{ state: 'pending' }]);
        expect(sent).toEqual([]);
        expect(await follows.approve('alice', MISSKEY)).toBe(true);
        expect(rows).toMatchObject([{ state: 'accepted' }]);
        expect(answers(sent)).toMatchObject([{ type: 'Accept', follow: { id: follow().id } }]);
        expect(notes).toEqual([`requested ${MISSKEY.id} → alice`, `settled alice ← ${MISSKEY.id}`]);
        // 2 度目の承認は何もしない
        expect(await follows.approve('alice', MISSKEY)).toBe(false);
        expect(sent).toHaveLength(1);
    });

    it('フォロワーから外すと Reject{Follow} を送り、相手はフォローを外す', async () => {
        const { follows, rows, sent } = setup();
        await follows.onFollow(MISSKEY, follow());
        expect(await follows.reject('alice', MISSKEY)).toBe('rejected');
        expect(rows).toEqual([]);
        expect(answers(sent).map((a) => a.type)).toEqual(['Accept', 'Reject']);
        expect(answers(sent)[1]?.follow).toMatchObject({ id: follow().id, type: 'Follow' });
        expect(await follows.reject('alice', MISSKEY)).toBe('absent');
    });

    it('フォロワーから Follow が来直したら（相手が覚えていない）、新しい id で答え直し、2 度は知らせない', async () => {
        const { follows, rows, sent, notes } = setup();
        await follows.onFollow(MISSKEY, follow());
        await follows.onFollow(MISSKEY, follow('https://misskey.example/follows/again'));
        expect(rows).toMatchObject([{ state: 'accepted', followId: 'https://misskey.example/follows/again' }]);
        expect(answers(sent).map((a) => (a.follow as { id: string }).id)).toEqual([
            follow().id,
            'https://misskey.example/follows/again',
        ]);
        expect(notes).toHaveLength(1);
    });

    it('新しいつながりを受けないサーバーからのフォローは、記録せずに断る', async () => {
        const { follows, rows, sent, notes } = setup({ policy: 'limit' });
        await follows.onFollow(MISSKEY, follow());
        expect(rows).toEqual([]);
        expect(answers(sent).map((a) => a.type)).toEqual(['Reject']);
        expect(notes).toEqual([]);
    });

    it('このサーバーにいない人・ほかのサーバーの人・サーバーの actor 宛ての Follow は何もしない', async () => {
        const { follows, rows, sent } = setup();
        await follows.onFollow(MISSKEY, follow(undefined, identity.actorUrl('ghost')));
        await follows.onFollow(MISSKEY, follow(undefined, 'https://b.example/ap/users/alice'));
        await follows.onFollow(MISSKEY, follow(undefined, identity.appActorUrl));
        expect(rows).toEqual([]);
        expect(sent).toEqual([]);
    });

    it('承認待ちが上限に達したら、それ以上は断る', async () => {
        const { follows, rows, sent } = setup({ manual: true });
        await Promise.all(
            Array.from({ length: FEDIVERSE_LIMITS.MAX_PENDING_FOLLOWS + 1 }, (_, i) =>
                follows.onFollow(
                    {
                        ...MISSKEY,
                        id: `https://misskey.example/users/${i}`,
                        inbox: `https://misskey.example/users/${i}/inbox`,
                    },
                    follow(`https://misskey.example/follows/${i}`),
                ),
            ),
        );
        expect(rows.filter((r) => r.state === 'pending')).toHaveLength(FEDIVERSE_LIMITS.MAX_PENDING_FOLLOWS);
        expect(answers(sent).map((a) => a.type)).toEqual(['Reject']);
    });

    it('Undo{Follow} でフォローを消す。承認待ちなら知らせも片付ける', async () => {
        const { follows, rows, notes } = setup({ manual: true });
        await follows.onFollow(MISSKEY, follow());
        expect(
            await follows.onUndo(MISSKEY, { id: follow().id, type: 'Follow', actor: MISSKEY.id, object: ALICE_URL }),
        ).toBe(true);
        expect(rows).toEqual([]);
        expect(notes).toEqual([`requested ${MISSKEY.id} → alice`, `settled alice ← ${MISSKEY.id}`]);
    });

    it('来直した Follow のあとに、前の Follow の Undo が遅れて届いても、いまのフォローは消さない', async () => {
        const { follows, rows } = setup();
        await follows.onFollow(MISSKEY, follow('https://misskey.example/follows/old'));
        await follows.onFollow(MISSKEY, follow('https://misskey.example/follows/new'));
        await follows.onUndo(MISSKEY, { id: 'https://misskey.example/follows/old', type: 'Follow' });
        expect(rows).toMatchObject([{ followId: 'https://misskey.example/follows/new' }]);
    });

    it('Follow の id が記録と違っても、埋め込まれた Follow の相手と宛先で引いて消す', async () => {
        const { follows, rows } = setup();
        await follows.onFollow(MISSKEY, follow());
        await follows.onUndo(MISSKEY, {
            id: 'https://misskey.example/other-id',
            type: 'Follow',
            actor: MISSKEY.id,
            object: ALICE_URL,
        });
        expect(rows).toEqual([]);
    });

    it('ほかの人の Follow は取り下げられない。フレンドの Undo（Offer）はフォローの扱いではない', async () => {
        const { follows, rows } = setup();
        await follows.onFollow(MISSKEY, follow());
        const mallory = { ...MISSKEY, id: 'https://misskey.example/users/mallory' };
        expect(await follows.onUndo(mallory, { id: follow().id, type: 'Follow' })).toBe(true);
        expect(rows).toHaveLength(1);
        expect(await follows.onUndo(MISSKEY, { id: 'https://misskey.example/offer', type: 'Offer' })).toBe(false);
        expect(rows).toHaveLength(1);
    });

    it('同時に届いた Follow と Undo のどちらが先に処理されても、フォローは残らない', async () => {
        const undo = { id: follow().id, type: 'Follow', object: ALICE_URL };
        const together = setup();
        await Promise.all([together.follows.onFollow(MISSKEY, follow()), together.follows.onUndo(MISSKEY, undo)]);
        expect(together.rows).toEqual([]);
        // Undo が先に届き、Follow が遅れて届いた
        const late = setup();
        await late.follows.onUndo(MISSKEY, undo);
        await late.follows.onFollow(MISSKEY, follow());
        expect(late.rows).toEqual([]);
        expect(late.sent).toEqual([]);
    });

    it('送る予定に入れられなければ、フォローも書かない（相手は送り直す）', async () => {
        const { follows, rows, notes } = setup({ failSend: true });
        await expect(follows.onFollow(MISSKEY, follow())).rejects.toThrow('送る予定に入れられない');
        expect(rows).toEqual([]);
        expect(notes).toEqual([]);
    });

    it('承認制をやめたら承認待ちをまとめて承認する。承認制にしただけでは何もしない', async () => {
        const { follows, rows, sent } = setup({ manual: true });
        const other = { ...MISSKEY, id: 'https://mastodon.example/users/bob', domain: 'mastodon.example' };
        await follows.onFollow(MISSKEY, follow());
        await follows.onFollow(other, follow('https://mastodon.example/1'));
        const manual = { ...DEFAULT_FEDIVERSE_SETTINGS, manuallyApprovesFollowers: true };
        expect(await follows.settingsChanged('alice', DEFAULT_FEDIVERSE_SETTINGS, manual)).toBe(0);
        expect(await follows.settingsChanged('alice', manual, DEFAULT_FEDIVERSE_SETTINGS)).toBe(2);
        expect(rows.map((r) => r.state)).toEqual(['accepted', 'accepted']);
        expect(answers(sent).map((a) => a.to)).toEqual([MISSKEY.inbox, `${other.id}/inbox`]);
    });

    it('actor が消えたらフォローを消し、承認待ちの知らせを片付ける', async () => {
        const { follows, rows, notes } = setup({ manual: true });
        await follows.onFollow(MISSKEY, follow());
        await follows.onActorDeleted(MISSKEY.id);
        expect(rows).toEqual([]);
        expect(notes.at(-1)).toBe(`settled alice ← ${MISSKEY.id}`);
    });
});
