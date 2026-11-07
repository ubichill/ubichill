import type { AnnouncementRecord, CreateNotificationInput, NotificationRecord } from '@ubichill/db';
import type { FeedPosition, NotificationStreamEvent } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import { createNotificationService } from './notifications';

const USERS: Record<string, { name: string; handle: string; createdAt: Date }> = {
    alice: { name: 'Alice', handle: 'alice', createdAt: new Date('2026-01-01T00:00:00Z') },
    bob: { name: 'Bob', handle: 'bob', createdAt: new Date('2026-01-01T00:00:00Z') },
    official: { name: 'Ubichill', handle: 'ubichill', createdAt: new Date('2026-01-01T00:00:00Z') },
    newcomer: { name: 'New', handle: 'newcomer', createdAt: new Date('2026-10-10T00:00:00Z') },
};

const olderThan = (at: Date, id: string, before?: FeedPosition) =>
    !before || at.getTime() < before.publishedMs || (at.getTime() === before.publishedMs && id < before.id);

/** DB の代わり（外部キー・一意キー・本人だけの既読を DB と同じ規則で持つ）。 */
function memoryStores() {
    const rows: Array<NotificationRecord & { dedupeKey: string }> = [];
    const anns: AnnouncementRecord[] = [];
    const reads = new Map<string, Date>();
    const seq = { n: 0 };
    const notifications = {
        async create(input: CreateNotificationInput, now = new Date()) {
            const actor = USERS[input.actorUserId];
            if (!actor || !USERS[input.recipientId]) return undefined;
            if (rows.some((r) => r.recipientId === input.recipientId && r.dedupeKey === input.dedupeKey))
                return undefined;
            seq.n += 1;
            const row = {
                id: `n${seq.n.toString().padStart(3, '0')}`,
                recipientId: input.recipientId,
                type: input.type,
                actorUserId: input.actorUserId,
                actorUri: null,
                actorName: actor.name,
                actorHandle: actor.handle,
                actorImage: null,
                object: input.object,
                createdAt: now,
                readAt: null,
                dedupeKey: input.dedupeKey,
            };
            rows.push(row);
            return row;
        },
        async listPage(recipientId: string, o: { before?: FeedPosition; limit: number }) {
            return rows
                .filter((r) => r.recipientId === recipientId && olderThan(r.createdAt, r.id, o.before))
                .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (b.id > a.id ? 1 : -1))
                .slice(0, o.limit);
        },
        async countUnread(recipientId: string) {
            return rows.filter((r) => r.recipientId === recipientId && !r.readAt).length;
        },
        async markRead(recipientId: string, ids: readonly string[], now = new Date()) {
            const hit = rows.filter((r) => r.recipientId === recipientId && ids.includes(r.id) && !r.readAt);
            for (const r of hit) r.readAt = now;
            return hit.map((r) => r.id);
        },
        async markAllRead(recipientId: string, now = new Date()) {
            const hit = rows.filter((r) => r.recipientId === recipientId && !r.readAt);
            for (const r of hit) r.readAt = now;
            return hit.length;
        },
        async markReadByKey(recipientId: string, key: string, now = new Date()) {
            const hit = rows.filter((r) => r.recipientId === recipientId && r.dedupeKey === key && !r.readAt);
            for (const r of hit) r.readAt = now;
            return hit.map((r) => r.id);
        },
        async removeBetween(a: string, b: string, types: readonly string[]) {
            const hit = rows.filter(
                (r) =>
                    types.includes(r.type) &&
                    ((r.recipientId === a && r.actorUserId === b) || (r.recipientId === b && r.actorUserId === a)),
            );
            for (const r of hit) rows.splice(rows.indexOf(r), 1);
            return hit.map((r) => ({ id: r.id, recipientId: r.recipientId }));
        },
    };
    const announcements = {
        async create(input: { authorId: string; title: string; content: string }, now = new Date()) {
            seq.n += 1;
            const author = USERS[input.authorId];
            const row = {
                id: `a${seq.n.toString().padStart(3, '0')}`,
                authorId: input.authorId,
                authorName: author?.name ?? null,
                authorHandle: author?.handle ?? null,
                authorImage: null,
                title: input.title,
                content: input.content,
                publishedAt: now,
            };
            anns.push(row);
            return row;
        },
        async listPage(o: { since: Date; before?: FeedPosition; limit: number }) {
            return anns
                .filter((a) => a.publishedAt >= o.since && olderThan(a.publishedAt, a.id, o.before))
                .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime())
                .slice(0, o.limit);
        },
        async findByIds(ids: readonly string[]) {
            return anns.filter((a) => ids.includes(a.id)).map((a) => ({ id: a.id, publishedAt: a.publishedAt }));
        },
        async readUntil(userId: string) {
            return reads.get(userId) ?? USERS[userId]?.createdAt;
        },
        async advanceReadUntil(userId: string, until: Date) {
            const current = reads.get(userId);
            if (!current || until > current) reads.set(userId, until);
        },
        async countAfter(readUntil: Date, since: Date) {
            return anns.filter((a) => a.publishedAt > readUntil && a.publishedAt >= since).length;
        },
    };
    return { notifications, announcements, rows };
}

function setup(start = '2026-10-20T00:00:00.000Z') {
    const clock = { now: new Date(start) };
    const stores = memoryStores();
    const delivered: Array<{ to: string; event: NotificationStreamEvent }> = [];
    const service = createNotificationService({
        ...stores,
        hub: { deliver: async (to, event) => void delivered.push({ to, event }) },
        now: () => clock.now,
    });
    const tick = (ms = 1000) => {
        clock.now = new Date(clock.now.getTime() + ms);
    };
    return { service, delivered, tick, clock, rows: stores.rows };
}

describe('通知を作る規則', () => {
    it('申請された人に Follow が届き、SSE にも流れる', async () => {
        const { service, delivered } = setup();
        const n = await service.followRequested('alice', 'bob');
        expect(n).toMatchObject({ type: 'Follow', actor: { id: 'alice', name: 'Alice' }, read: false });
        expect(delivered).toEqual([{ to: 'bob', event: { type: 'notification', notification: n } }]);
    });

    it('自分の操作は自分に通知しない', async () => {
        const { service, delivered, rows } = setup();
        expect(await service.followRequested('alice', 'alice')).toBeUndefined();
        expect(await service.friendAccepted('alice', 'alice')).toBeUndefined();
        expect(
            await service.worldLiked('alice', { url: 'https://x.example/w.yaml', name: 'W', authorId: 'alice' }),
        ).toBe(undefined);
        expect(rows).toEqual([]);
        expect(delivered).toEqual([]);
    });

    it('同じ人が何度お気に入りし直しても、作者への Like は 1 つ（2 回目は流さない）', async () => {
        const { service, delivered, tick } = setup();
        const world = { url: 'https://x.example/w.yaml', name: 'W', authorId: 'bob' };
        await service.worldLiked('alice', world);
        tick();
        await service.worldLiked('alice', world);
        expect(delivered).toHaveLength(1);
        // 別のワールドなら別の通知
        await service.worldLiked('alice', { ...world, url: 'https://x.example/w2.yaml' });
        expect(delivered).toHaveLength(2);
    });

    it('消えた相手（いないユーザー）には作らない・流さない', async () => {
        const { service, delivered } = setup();
        expect(await service.followRequested('alice', 'ghost')).toBeUndefined();
        expect(await service.followRequested('ghost', 'bob')).toBeUndefined();
        expect(delivered).toEqual([]);
    });

    it('承認すると申請した人に Accept、承認した人の申請の通知は既読になる（ほかのタブにも流す）', async () => {
        const { service, delivered } = setup();
        const follow = await service.followRequested('alice', 'bob');
        delivered.length = 0;
        const accept = await service.friendAccepted('bob', 'alice');
        expect(accept).toMatchObject({
            type: 'Accept',
            actor: { id: 'bob' },
            object: { actor: 'alice', object: 'bob' },
        });
        expect(delivered).toEqual([
            { to: 'bob', event: { type: 'read', ids: [follow?.id] } },
            { to: 'alice', event: { type: 'notification', notification: accept } },
        ]);
        expect(await service.unreadCount('bob')).toBe(0);
    });

    it('関係が消えたら 2 人の間の申請・承認の通知を消し、申請し直せばまた届く', async () => {
        const { service, delivered, tick } = setup();
        const follow = await service.followRequested('alice', 'bob');
        await service.friendshipRemoved('bob', 'alice');
        expect(delivered.at(-1)).toEqual({ to: 'bob', event: { type: 'removed', ids: [follow?.id] } });
        tick();
        expect(await service.followRequested('alice', 'bob')).toBeDefined();
    });
});

describe('一覧・未読・既読', () => {
    it('他人の通知の ID を渡しても既読にならない', async () => {
        const { service, delivered } = setup();
        const toBob = await service.followRequested('alice', 'bob');
        delivered.length = 0;
        expect(await service.markRead('alice', { ids: [toBob?.id ?? ''] })).toBe(0);
        expect(delivered).toEqual([]);
        expect(await service.unreadCount('bob')).toBe(1);
    });

    it('カーソルで最後まで送ると、通知とお知らせが新しい順に重ならず並ぶ', async () => {
        const { service, tick } = setup();
        for (const n of [1, 2, 3]) {
            await service.worldLiked('alice', { url: `https://x.example/w${n}.yaml`, name: `w${n}`, authorId: 'bob' });
            tick();
            await service.publishAnnouncement({ id: 'official', handle: 'ubichill' }, { title: `t${n}`, content: 'c' });
            tick();
        }
        const walk = async (cursor: string | undefined, acc: string[]): Promise<string[]> => {
            const page = await service.listFeed('bob', { cursor, limit: 4 });
            if (!page.ok) throw new Error('bad cursor');
            const ids = [...acc, ...page.items.map((i) => i.type)];
            return page.nextCursor ? walk(page.nextCursor, ids) : ids;
        };
        expect(await walk(undefined, [])).toEqual(['Announce', 'Like', 'Announce', 'Like', 'Announce', 'Like']);
    });

    it('壊れたカーソルは失敗にする（最初のページを返さない）', async () => {
        const { service } = setup();
        expect(await service.listFeed('bob', { cursor: '../../etc' })).toEqual({ ok: false, error: 'bad-cursor' });
    });

    it('ページの大きさは 1〜50 に丸める', async () => {
        const { service, tick } = setup();
        for (const n of [1, 2]) {
            await service.worldLiked('alice', { url: `https://x.example/w${n}.yaml`, name: `w${n}`, authorId: 'bob' });
            tick();
        }
        const page = await service.listFeed('bob', { limit: 0 });
        expect(page.ok && page.items).toHaveLength(1);
    });
});

describe('運営のお知らせ', () => {
    it('公式アカウント以外は出せない（何も配らない）', async () => {
        const { service, delivered } = setup();
        expect(
            await service.publishAnnouncement({ id: 'alice', handle: 'alice' }, { title: 't', content: 'c' }),
        ).toEqual({
            ok: false,
            error: 'forbidden',
        });
        expect(
            await service.publishAnnouncement({ id: 'alice', handle: undefined }, { title: 't', content: 'c' }),
        ).toEqual({ ok: false, error: 'forbidden' });
        expect(delivered).toEqual([]);
    });

    it('全員に 1 回配り、読む人ごとの既読の位置で未読が決まる', async () => {
        const { service, delivered } = setup();
        const result = await service.publishAnnouncement(
            { id: 'official', handle: 'ubichill' },
            { title: 't', content: 'c' },
        );
        expect(delivered).toEqual([
            { to: '*', event: { type: 'notification', notification: result.ok && result.notification } },
        ]);
        expect(await service.unreadCount('alice')).toBe(1);
        expect(await service.unreadCount('bob')).toBe(1);
    });

    it('登録より前に出したお知らせは、新しい人には既読で見える（未読に数えない）', async () => {
        const { service, clock } = setup('2026-10-01T00:00:00.000Z');
        await service.publishAnnouncement({ id: 'official', handle: 'ubichill' }, { title: 'old', content: 'c' });
        clock.now = new Date('2026-10-20T00:00:00.000Z');
        expect(await service.unreadCount('newcomer')).toBe(0);
        const page = await service.listFeed('newcomer', {});
        expect(page.ok && page.items.map((i) => i.read)).toEqual([true]);
    });

    it('あるお知らせを既読にすると、それより前のお知らせも既読になる（位置を進めるだけ）', async () => {
        const { service, tick } = setup();
        const official = { id: 'official', handle: 'ubichill' };
        const first = await service.publishAnnouncement(official, { title: '1', content: 'c' });
        tick();
        const second = await service.publishAnnouncement(official, { title: '2', content: 'c' });
        tick();
        const third = await service.publishAnnouncement(official, { title: '3', content: 'c' });
        if (!first.ok || !second.ok || !third.ok) throw new Error('出せていない');
        expect(await service.markRead('alice', { ids: [second.notification.id] })).toBe(1);
        // 古いお知らせを既読にしても位置は戻らない
        expect(await service.markRead('alice', { ids: [first.notification.id] })).toBe(1);
        const page = await service.listFeed('alice', {});
        expect(page.ok && page.items.map((i) => [i.object.type === 'Note' && i.object.summary, i.read])).toEqual([
            ['3', false],
            ['2', true],
            ['1', true],
        ]);
    });

    it('全部を既読にすると、通知とお知らせの両方が 0 になり、ほかのタブにも流す', async () => {
        const { service, delivered, tick } = setup();
        await service.followRequested('alice', 'bob');
        await service.publishAnnouncement({ id: 'official', handle: 'ubichill' }, { title: 't', content: 'c' });
        tick();
        delivered.length = 0;
        expect(await service.markRead('bob', { all: true })).toBe(0);
        expect(delivered).toEqual([{ to: 'bob', event: { type: 'read' } }]);
        expect(await service.unreadCount('alice')).toBe(1);
    });
});
