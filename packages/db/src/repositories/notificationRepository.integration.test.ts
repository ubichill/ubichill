import { type FeedPosition, feedPositionOf } from '@ubichill/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { announcementRepository } from './announcementRepository';
import { notificationRepository } from './notificationRepository';
import { userRepository } from './userRepository';

/**
 * 通知・お知らせの DB 統合テスト。DATABASE_URL がある時だけ走る。
 */
const RUN = !!process.env.DATABASE_URL;
const stamp = Date.now().toString(36);
const ids = { a: `nt-a-${stamp}`, b: `nt-b-${stamp}`, c: `nt-c-${stamp}`, gone: `nt-gone-${stamp}` };
const follow = (recipientId: string, actorUserId: string) => ({
    recipientId,
    type: 'Follow' as const,
    actorUserId,
    object: { type: 'Person', id: recipientId },
    dedupeKey: `Follow:${actorUserId}`,
});

describe.skipIf(!RUN)('notificationRepository / announcementRepository (DB統合)', () => {
    beforeAll(async () => {
        for (const [key, id] of Object.entries(ids)) {
            await userRepository.create({
                id,
                name: `通知${key}_${stamp}`,
                email: `${id}@example.com`,
                handle: `nt${key}_${stamp}`.slice(0, 30),
            });
        }
    });

    afterAll(async () => {
        for (const id of Object.values(ids)) await userRepository.deleteById(id);
    });

    it('作った通知は actor の表示名付きで読め、同じキーの 2 回目は作らない', async () => {
        const first = await notificationRepository.create(follow(ids.a, ids.b));
        expect(first).toMatchObject({ recipientId: ids.a, actorUserId: ids.b, actorName: `通知b_${stamp}` });
        expect(await notificationRepository.create(follow(ids.a, ids.b))).toBeUndefined();
        expect(await notificationRepository.countUnread(ids.a)).toBe(1);
    });

    it('相手か受け手がいなければ作らない（例外にしない）', async () => {
        expect(await notificationRepository.create(follow(ids.a, `missing-${stamp}`))).toBeUndefined();
        expect(await notificationRepository.create(follow(`missing-${stamp}`, ids.a))).toBeUndefined();
    });

    it('actor が消えると、その人からの通知も消える', async () => {
        const created = await notificationRepository.create(follow(ids.c, ids.gone));
        expect(created).toBeDefined();
        await userRepository.deleteById(ids.gone);
        expect(await notificationRepository.findById(ids.c, created?.id ?? '')).toBeUndefined();
    });

    it('他人の通知は既読にできない。既読にしたものは返らない', async () => {
        const mine = await notificationRepository.create(follow(ids.b, ids.c));
        if (!mine) throw new Error('作れていない');
        expect(await notificationRepository.markRead(ids.a, [mine.id])).toEqual([]);
        expect((await notificationRepository.findById(ids.b, mine.id))?.readAt).toBeNull();
        expect(await notificationRepository.markRead(ids.b, [mine.id, 'nope'])).toEqual([mine.id]);
        expect(await notificationRepository.markRead(ids.b, [mine.id])).toEqual([]);
        expect(await notificationRepository.countUnread(ids.b)).toBe(0);
    });

    it('カーソルで送ると、同じ時刻の通知も重ならず漏れない', async () => {
        const at = new Date(Date.now() - 60_000);
        const created = [];
        for (const n of [1, 2, 3, 4, 5]) {
            created.push(
                await notificationRepository.create(
                    {
                        recipientId: ids.c,
                        type: 'Like',
                        actorUserId: ids.a,
                        object: { type: 'World', id: `https://x.example/w${n}.yaml`, name: `w${n}` },
                        dedupeKey: `Like:${ids.a}:w${n}`,
                    },
                    at,
                ),
            );
        }
        const pages: string[][] = [];
        const walk = async (before: FeedPosition | undefined): Promise<void> => {
            const page = await notificationRepository.listPage(ids.c, { before, limit: 2 });
            if (page.length === 0) return;
            pages.push(page.map((r) => r.id));
            const last = page.at(-1);
            if (last) await walk(feedPositionOf({ id: last.id, published: last.createdAt.toISOString() }));
        };
        await walk(undefined);
        const seen = pages.flat();
        expect(new Set(seen).size).toBe(seen.length);
        expect(new Set(seen)).toEqual(new Set(created.map((c) => c?.id)));
    });

    it('2 人の間の申請の通知だけを消す（向きは問わない）', async () => {
        await notificationRepository.create(follow(ids.b, ids.a));
        const removed = await notificationRepository.removeBetween(ids.b, ids.a, ['Follow']);
        expect(removed.map((r) => r.recipientId).sort()).toEqual([ids.a, ids.b].sort());
        // c 宛ての Like（actor は a）は残る
        expect((await notificationRepository.listPage(ids.c, { limit: 10 })).length).toBeGreaterThan(0);
    });

    it('古い通知と、1 人あたりの上限を超えた分を消す', async () => {
        const old = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000);
        await notificationRepository.create({ ...follow(ids.a, ids.c), dedupeKey: `old:${stamp}` }, old);
        // c には Like が 5 件ある。上限 3 なら古い 2 件が消える
        const deleted = await notificationRepository.deleteExpired(new Date(Date.now() - 90 * 24 * 60 * 60 * 1000), 3);
        expect(deleted).toBeGreaterThanOrEqual(3);
        expect(await notificationRepository.listPage(ids.c, { limit: 10 })).toHaveLength(3);
        const aItems = await notificationRepository.listPage(ids.a, { limit: 10 });
        expect(aItems.some((r) => r.createdAt.getTime() === old.getTime())).toBe(false);
    });

    it('お知らせの既読の位置: 行が無ければ登録した時刻、進めるだけで戻らない', async () => {
        const user = await userRepository.findById(ids.a);
        const initial = await announcementRepository.readUntil(ids.a);
        expect(initial?.getTime()).toBe(user?.createdAt.getTime());
        expect(await announcementRepository.readUntil(`missing-${stamp}`)).toBeUndefined();

        const later = new Date(Date.now() + 60_000);
        await announcementRepository.advanceReadUntil(ids.a, later);
        await announcementRepository.advanceReadUntil(ids.a, new Date(0));
        expect((await announcementRepository.readUntil(ids.a))?.getTime()).toBe(later.getTime());
    });

    it('位置より後のお知らせだけを未読に数える', async () => {
        const since = new Date(Date.now() - 1000);
        const published = new Date(Date.now() + 120_000);
        const created = await announcementRepository.create(
            { authorId: ids.b, title: `t${stamp}`, content: '本文' },
            published,
        );
        expect(created.authorName).toBe(`通知b_${stamp}`);
        const readUntil = (await announcementRepository.readUntil(ids.c)) ?? new Date();
        expect(await announcementRepository.countAfter(readUntil, since)).toBeGreaterThanOrEqual(1);
        expect(await announcementRepository.countAfter(published, since)).toBe(0);
        await announcementRepository.deleteExpired(new Date(published.getTime() + 1));
        expect(await announcementRepository.findByIds([created.id])).toEqual([]);
    });
});
