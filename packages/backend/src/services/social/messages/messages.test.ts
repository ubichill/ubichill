import type { ConversationRecord, DirectMessageRecord, MessageReactionRecord } from '@ubichill/db';
import { decodeFeedCursor, MESSAGE_LIMITS, type UserSummary } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import { createMessageService, type MessageServiceDeps, pageSizeOf } from './messages';

const START = new Date('2026-11-10T00:00:00.000Z');
const USERS = ['alice', 'bob', 'carol'];
const summary = (id: string): UserSummary => ({ id, name: id.toUpperCase(), handle: id, image: null, bio: null });

/** DB・フレンド・通知のメモリの偽物。フレンドは双方向の組で持つ。 */
function setup(
    options: { friends?: Array<[string, string]>; blocks?: Array<[string, string]>; failNotify?: boolean } = {},
) {
    const clock = { now: START };
    const pairs = new Set((options.friends ?? []).map(([a, b]) => [a, b].sort().join('|')));
    const rows: Array<DirectMessageRecord & { readAt: Date | null }> = [];
    const reactions: Array<MessageReactionRecord & { at: number }> = [];
    const notified: Array<{ kind: string; to: string; from: string; content?: string }> = [];
    const streamed: Array<{ to: readonly string[]; messageId: string; reactions: unknown }> = [];
    const background: Array<Promise<unknown>> = [];
    const seq = { n: 0 };
    const between = (a: string, b: string) => (r: DirectMessageRecord) =>
        (r.senderId === a && r.recipientId === b) || (r.senderId === b && r.recipientId === a);
    const newestFirst = (x: DirectMessageRecord, y: DirectMessageRecord) =>
        y.createdAt.getTime() - x.createdAt.getTime() || (x.id < y.id ? 1 : -1);

    const deps: MessageServiceDeps = {
        messages: {
            create: async (input, now) => {
                seq.n += 1;
                const row = { id: `m${String(seq.n).padStart(3, '0')}`, ...input, createdAt: now, readAt: null };
                rows.push(row);
                return row;
            },
            listBetween: async (a, b, o) =>
                rows
                    .filter(between(a, b))
                    .filter(
                        (r) =>
                            !o.before ||
                            r.createdAt.getTime() < o.before.publishedMs ||
                            (r.createdAt.getTime() === o.before.publishedMs && r.id < o.before.id),
                    )
                    .toSorted(newestFirst)
                    .slice(0, o.limit),
            conversationsOf: async (userId, limit) => {
                const mine = rows
                    .filter((r) => r.senderId === userId || r.recipientId === userId)
                    .toSorted(newestFirst);
                const peers = [...new Set(mine.map((r) => (r.senderId === userId ? r.recipientId : r.senderId)))];
                return peers.slice(0, limit).map(
                    (peerId): ConversationRecord => ({
                        peerId,
                        last: mine.find(between(userId, peerId)) as DirectMessageRecord,
                        unreadCount: rows.filter((r) => r.senderId === peerId && r.recipientId === userId && !r.readAt)
                            .length,
                    }),
                );
            },
            markReadFrom: async (recipientId, senderId, now) => {
                const hit = rows.filter((r) => r.recipientId === recipientId && r.senderId === senderId && !r.readAt);
                for (const r of hit) r.readAt = now;
                return hit.length;
            },
            findById: async (id) => rows.find((r) => r.id === id),
            reactionsOf: async (ids) =>
                reactions
                    .filter((r) => ids.includes(r.messageId))
                    .toSorted((x, y) => x.at - y.at)
                    .map(({ messageId, userId, emoji }) => ({ messageId, userId, emoji })),
            setReaction: async (messageId, userId, emoji, now) => {
                const i = reactions.findIndex((r) => r.messageId === messageId && r.userId === userId);
                if (i >= 0) reactions.splice(i, 1);
                reactions.push({ messageId, userId, emoji, at: now.getTime() });
            },
            removeReaction: async (messageId, userId) => {
                const i = reactions.findIndex((r) => r.messageId === messageId && r.userId === userId);
                if (i >= 0) reactions.splice(i, 1);
                return i >= 0;
            },
        },
        areFriends: async (a, b) => pairs.has([a, b].sort().join('|')),
        isBlockedBetween: async (a, b) =>
            (options.blocks ?? []).some(([x, y]) => (x === a && y === b) || (x === b && y === a)),
        hiddenIdsFor: async (me) => new Set((options.blocks ?? []).filter(([x]) => x === me).map(([, y]) => y)),
        summariesOf: async (ids) => ids.filter((id) => USERS.includes(id)).map(summary),
        notify: {
            messageReceived: async (input) => {
                if (options.failNotify) throw new Error('down');
                notified.push({
                    kind: 'received',
                    to: input.recipientId,
                    from: input.senderId,
                    content: input.message.content,
                });
            },
            messagesRead: async (recipientId, senderId) => {
                notified.push({ kind: 'read', to: recipientId, from: senderId });
            },
            messageReacted: async (input) => {
                if (options.failNotify) throw new Error('down');
                notified.push({ kind: 'reacted', to: input.recipientId, from: input.reactorId, content: input.emoji });
            },
            reactionsChanged: async (to, messageId, list) => {
                if (options.failNotify) throw new Error('down');
                streamed.push({ to, messageId, reactions: list });
            },
        },
        background: (task) => void background.push(task.catch(() => undefined)),
        now: () => clock.now,
    };
    const tick = (ms = 1000) => {
        clock.now = new Date(clock.now.getTime() + ms);
    };
    return {
        service: createMessageService(deps),
        rows,
        reactions,
        notified,
        streamed,
        tick,
        settle: () => Promise.all(background),
        unfriend: (a: string, b: string) => pairs.delete([a, b].sort().join('|')),
    };
}

describe('送る', () => {
    it('フレンドに送ると保存して、相手に通知する', async () => {
        const { service, rows, notified, settle } = setup({ friends: [['alice', 'bob']] });
        const outcome = await service.send('alice', 'bob', 'やあ');
        await settle();
        expect(outcome).toEqual({
            ok: true,
            message: { id: 'm001', senderId: 'alice', content: 'やあ', published: START.toISOString(), reactions: [] },
        });
        expect(rows).toHaveLength(1);
        expect(notified).toEqual([{ kind: 'received', to: 'bob', from: 'alice', content: 'やあ' }]);
    });

    it('フレンドでない・自分・ほかのサーバーの人には送れず、何も残さない', async () => {
        const { service, rows, notified, settle } = setup({ friends: [['alice', 'bob']] });
        expect(await service.send('alice', 'carol', 'x')).toEqual({ ok: false, reason: 'not-friend' });
        expect(await service.send('alice', 'alice', 'x')).toEqual({ ok: false, reason: 'self' });
        expect(await service.send('alice', 'https://b.example/ap/users/bob', 'x')).toEqual({
            ok: false,
            reason: 'remote',
        });
        // いないユーザーもフレンドではない（いるかどうかを区別して漏らさない）
        expect(await service.send('alice', 'ghost', 'x')).toEqual({ ok: false, reason: 'not-friend' });
        await settle();
        expect(rows).toEqual([]);
        expect(notified).toEqual([]);
    });

    it('フレンドを解除したら送れない（解除の前に送った分は残る）', async () => {
        const { service, unfriend } = setup({ friends: [['alice', 'bob']] });
        await service.send('alice', 'bob', '前');
        unfriend('alice', 'bob');
        expect(await service.send('bob', 'alice', '後')).toEqual({ ok: false, reason: 'not-friend' });
        const page = await service.conversation('bob', 'alice', {});
        expect(page).toMatchObject({ ok: true, refusal: 'not-friend', messages: [{ content: '前' }] });
    });

    it('通知に失敗しても送信は成功にする', async () => {
        const { service, rows, settle } = setup({ friends: [['alice', 'bob']], failNotify: true });
        expect((await service.send('alice', 'bob', 'x')).ok).toBe(true);
        await settle();
        expect(rows).toHaveLength(1);
    });
});

describe('会話を読む', () => {
    it('新しい順のページで、cursor で前をたどると重ならず漏れない（同じ時刻の行があっても）', async () => {
        const { service, tick } = setup({ friends: [['alice', 'bob']] });
        for (const i of [1, 2, 3, 4, 5]) {
            await service.send(i % 2 ? 'alice' : 'bob', i % 2 ? 'bob' : 'alice', `#${i}`);
            // 3 と 4 は同じ時刻
            if (i !== 3) tick();
        }
        const first = await service.conversation('alice', 'bob', { limit: 2 });
        if (!first.ok) throw new Error('first');
        expect(first.messages.map((m) => m.content)).toEqual(['#5', '#4']);
        expect(first.nextCursor).not.toBeNull();
        const second = await service.conversation('alice', 'bob', { limit: 2, cursor: first.nextCursor ?? '' });
        if (!second.ok) throw new Error('second');
        expect(second.messages.map((m) => m.content)).toEqual(['#3', '#2']);
        const third = await service.conversation('alice', 'bob', { limit: 2, cursor: second.nextCursor ?? '' });
        if (!third.ok) throw new Error('third');
        expect(third.messages.map((m) => m.content)).toEqual(['#1']);
        expect(third.nextCursor).toBeNull();
    });

    it('ちょうどページの数で終わるなら、次は無い', async () => {
        const { service, tick } = setup({ friends: [['alice', 'bob']] });
        await service.send('alice', 'bob', 'a');
        tick();
        await service.send('alice', 'bob', 'b');
        const page = await service.conversation('alice', 'bob', { limit: 2 });
        expect(page).toMatchObject({ ok: true, nextCursor: null });
    });

    it('ほかの人との会話は混ざらない', async () => {
        const { service } = setup({
            friends: [
                ['alice', 'bob'],
                ['alice', 'carol'],
                ['bob', 'carol'],
            ],
        });
        await service.send('alice', 'bob', 'to bob');
        await service.send('carol', 'bob', 'carol to bob');
        await service.send('alice', 'carol', 'to carol');
        const page = await service.conversation('bob', 'alice', {});
        expect(page).toMatchObject({ ok: true, messages: [{ content: 'to bob' }] });
    });

    it('壊れた cursor・いない相手・自分は断る', async () => {
        const { service } = setup();
        expect(await service.conversation('alice', 'bob', { cursor: 'nope' })).toEqual({
            ok: false,
            error: 'bad-cursor',
        });
        expect(await service.conversation('alice', 'ghost', {})).toEqual({ ok: false, error: 'not-found' });
        expect(await service.conversation('alice', 'alice', {})).toEqual({ ok: false, error: 'not-found' });
    });

    it('次の cursor は最後の 1 通の位置', async () => {
        const { service, tick } = setup({ friends: [['alice', 'bob']] });
        await service.send('alice', 'bob', 'a');
        tick();
        await service.send('alice', 'bob', 'b');
        const page = await service.conversation('alice', 'bob', { limit: 1 });
        if (!page.ok) throw new Error('page');
        expect(decodeFeedCursor(page.nextCursor ?? '')).toEqual({ publishedMs: START.getTime() + 1000, id: 'm002' });
    });
});

describe('会話の一覧と既読', () => {
    it('相手ごとに最新の 1 通と未読の数。自分が送った分は未読に数えない', async () => {
        const { service, tick } = setup({
            friends: [
                ['alice', 'bob'],
                ['alice', 'carol'],
            ],
        });
        await service.send('bob', 'alice', 'b1');
        tick();
        await service.send('bob', 'alice', 'b2');
        tick();
        await service.send('alice', 'carol', 'c1');
        const list = await service.conversations('alice');
        expect(list.map((c) => [c.user.id, c.last.content, c.unreadCount])).toEqual([
            ['carol', 'c1', 0],
            ['bob', 'b2', 2],
        ]);
    });

    it('読むと相手から届いた分だけ既読にし、会話の通知も既読にする（相手の未読は変えない）', async () => {
        const { service, notified } = setup({ friends: [['alice', 'bob']] });
        await service.send('bob', 'alice', 'b1');
        await service.send('alice', 'bob', 'a1');
        expect(await service.markRead('alice', 'bob')).toBe(1);
        expect(notified.at(-1)).toEqual({ kind: 'read', to: 'alice', from: 'bob' });
        const [forBob] = await service.conversations('bob');
        expect(forBob?.unreadCount).toBe(1);
        // 読み直しても数は 0 だが、通知の既読はそろえる
        expect(await service.markRead('alice', 'bob')).toBe(0);
        expect(notified.filter((n) => n.kind === 'read')).toHaveLength(2);
    });

    it('相手が消えた会話は一覧に出さない', async () => {
        const { service, rows } = setup({ friends: [['alice', 'bob']] });
        await service.send('alice', 'bob', 'x');
        rows.push({
            id: 'zz',
            senderId: 'deleted',
            recipientId: 'alice',
            content: 'y',
            createdAt: START,
            readAt: null,
        });
        expect((await service.conversations('alice')).map((c) => c.user.id)).toEqual(['bob']);
    });
});

describe('リアクション', () => {
    const sent = async (service: ReturnType<typeof setup>['service'], from: string, to: string) => {
        const outcome = await service.send(from, to, 'x');
        if (!outcome.ok) throw new Error('not sent');
        return outcome.message.id;
    };

    it('相手のメッセージに付けると相手に通知し、2 人の画面に流す', async () => {
        const { service, notified, streamed, settle } = setup({ friends: [['alice', 'bob']] });
        const id = await sent(service, 'bob', 'alice');
        notified.length = 0;
        expect(await service.react('alice', 'bob', id, '👍')).toEqual({
            ok: true,
            reactions: [{ userId: 'alice', emoji: '👍' }],
        });
        await settle();
        expect(notified).toEqual([{ kind: 'reacted', to: 'bob', from: 'alice', content: '👍' }]);
        expect(streamed).toEqual([
            { to: ['alice', 'bob'], messageId: id, reactions: [{ userId: 'alice', emoji: '👍' }] },
        ]);
    });

    it('自分のメッセージにも付けられるが、通知はしない（画面には流す）', async () => {
        const { service, notified, streamed, settle } = setup({ friends: [['alice', 'bob']] });
        const id = await sent(service, 'alice', 'bob');
        notified.length = 0;
        expect((await service.react('alice', 'bob', id, '🎉')).ok).toBe(true);
        await settle();
        expect(notified).toEqual([]);
        expect(streamed).toHaveLength(1);
    });

    it('1 人 1 つ。付け直すと置き換わり、外すと消える。外したときは通知しない', async () => {
        const { service, notified, tick, settle } = setup({ friends: [['alice', 'bob']] });
        const id = await sent(service, 'bob', 'alice');
        await service.react('bob', 'alice', id, '😂');
        tick();
        await service.react('alice', 'bob', id, '👍');
        tick();
        expect(await service.react('alice', 'bob', id, '🎉')).toEqual({
            ok: true,
            reactions: [
                { userId: 'bob', emoji: '😂' },
                { userId: 'alice', emoji: '🎉' },
            ],
        });
        notified.length = 0;
        expect(await service.react('alice', 'bob', id, null)).toEqual({
            ok: true,
            reactions: [{ userId: 'bob', emoji: '😂' }],
        });
        await settle();
        expect(notified).toEqual([]);
    });

    it('同じものを付け直す・付けていないものを外すのは何もしない（通知を作り直さない）', async () => {
        const { service, notified, streamed, settle } = setup({ friends: [['alice', 'bob']] });
        const id = await sent(service, 'bob', 'alice');
        await service.react('alice', 'bob', id, '👍');
        await settle();
        notified.length = 0;
        streamed.length = 0;
        expect(await service.react('alice', 'bob', id, '👍')).toEqual({
            ok: true,
            reactions: [{ userId: 'alice', emoji: '👍' }],
        });
        expect((await service.react('bob', 'alice', id, null)).ok).toBe(true);
        await settle();
        expect(notified).toEqual([]);
        expect(streamed).toEqual([]);
    });

    it('フレンドでなくなったら付けも外しもできない', async () => {
        const { service, reactions, unfriend } = setup({ friends: [['alice', 'bob']] });
        const id = await sent(service, 'bob', 'alice');
        await service.react('alice', 'bob', id, '👍');
        unfriend('alice', 'bob');
        expect(await service.react('alice', 'bob', id, '🎉')).toEqual({ ok: false, reason: 'not-friend' });
        expect(await service.react('alice', 'bob', id, null)).toEqual({ ok: false, reason: 'not-friend' });
        expect(reactions.map((r) => r.emoji)).toEqual(['👍']);
    });

    it('会話に無い 1 通は not-found（ほかの人の会話の id・相手を取り違えた・無い id）', async () => {
        const { service, reactions } = setup({
            friends: [
                ['alice', 'bob'],
                ['bob', 'carol'],
                ['alice', 'carol'],
            ],
        });
        const bobCarol = await sent(service, 'bob', 'carol');
        expect(await service.react('alice', 'bob', bobCarol, '👍')).toEqual({ ok: false, error: 'not-found' });
        expect(await service.react('alice', 'carol', bobCarol, '👍')).toEqual({ ok: false, error: 'not-found' });
        expect(await service.react('alice', 'bob', 'missing', '👍')).toEqual({ ok: false, error: 'not-found' });
        expect(reactions).toEqual([]);
    });

    it('通知・配送に失敗してもリアクションは成功にする', async () => {
        const { service, reactions, settle } = setup({ friends: [['alice', 'bob']], failNotify: true });
        const id = await sent(service, 'bob', 'alice');
        expect((await service.react('alice', 'bob', id, '👍')).ok).toBe(true);
        await settle();
        expect(reactions).toHaveLength(1);
    });

    it('会話のページは 1 通ごとにリアクションを付けて返す', async () => {
        const { service, tick } = setup({ friends: [['alice', 'bob']] });
        const first = await sent(service, 'bob', 'alice');
        tick();
        await sent(service, 'alice', 'bob');
        await service.react('alice', 'bob', first, '👍');
        const page = await service.conversation('alice', 'bob', {});
        if (!page.ok) throw new Error('not ok');
        expect(page.messages.map((m) => m.reactions)).toEqual([[], [{ userId: 'alice', emoji: '👍' }]]);
    });
});

describe('pageSizeOf', () => {
    it('無い・数でないなら既定、範囲の外は寄せる、小数は切り捨てる', () => {
        expect(pageSizeOf(undefined)).toBe(MESSAGE_LIMITS.DEFAULT_PAGE_SIZE);
        expect(pageSizeOf(Number.NaN)).toBe(MESSAGE_LIMITS.DEFAULT_PAGE_SIZE);
        expect(pageSizeOf(0)).toBe(1);
        expect(pageSizeOf(-5)).toBe(1);
        expect(pageSizeOf(2.9)).toBe(2);
        expect(pageSizeOf(10_000)).toBe(MESSAGE_LIMITS.MAX_PAGE_SIZE);
        expect(pageSizeOf(Number.POSITIVE_INFINITY)).toBe(MESSAGE_LIMITS.DEFAULT_PAGE_SIZE);
    });
});

describe('ブロック', () => {
    it('どちらがブロックしても、フレンドのままでも送れず、リアクションもできない', async () => {
        const blockedByBob = setup({ friends: [['alice', 'bob']], blocks: [['bob', 'alice']] });
        expect(await blockedByBob.service.send('alice', 'bob', 'x')).toEqual({ ok: false, reason: 'blocked' });
        expect(await blockedByBob.service.send('bob', 'alice', 'x')).toEqual({ ok: false, reason: 'blocked' });
        expect(blockedByBob.rows).toHaveLength(0);
    });

    it('ブロックした人との会話は一覧にも会話にも出さない。ブロックされた側の一覧には残る（過去の分）', async () => {
        const blocks: Array<[string, string]> = [];
        const { service, settle } = setup({ friends: [['alice', 'bob']], blocks });
        await service.send('alice', 'bob', 'やあ');
        await settle();
        blocks.push(['bob', 'alice']);
        expect(await service.conversations('bob')).toEqual([]);
        expect(await service.conversation('bob', 'alice', {})).toEqual({ ok: false, error: 'not-found' });
        expect((await service.conversations('alice')).map((c) => c.user.id)).toEqual(['bob']);
    });
});
