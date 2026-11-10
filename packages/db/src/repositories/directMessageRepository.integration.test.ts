import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { directMessageRepository } from './directMessageRepository';
import { notificationRepository } from './notificationRepository';
import { userRepository } from './userRepository';

/** フレンド同士のメッセージの保存（DB 統合）。DATABASE_URL がある時だけ走る。 */
const RUN = !!process.env.DATABASE_URL;
const stamp = Date.now().toString(36);
const ids = { a: `dm-a-${stamp}`, b: `dm-b-${stamp}`, c: `dm-c-${stamp}`, gone: `dm-x-${stamp}` };
const T0 = new Date('2026-11-10T00:00:00.000Z');
const at = (s: number) => new Date(T0.getTime() + s * 1000);

describe.skipIf(!RUN)('directMessageRepository（DB統合）', () => {
    beforeAll(async () => {
        for (const id of Object.values(ids)) {
            await userRepository.create({ id, name: id, email: `${id}@example.com`, handle: id.replaceAll('-', '_') });
        }
        await directMessageRepository.create({ senderId: ids.a, recipientId: ids.b, content: 'a→b 1' }, at(1));
        await directMessageRepository.create({ senderId: ids.b, recipientId: ids.a, content: 'b→a 1' }, at(2));
        await directMessageRepository.create({ senderId: ids.b, recipientId: ids.a, content: 'b→a 2' }, at(2));
        await directMessageRepository.create({ senderId: ids.c, recipientId: ids.a, content: 'c→a 1' }, at(3));
    });

    afterAll(async () => {
        for (const id of Object.values(ids)) await userRepository.deleteById(id);
    });

    it('自分に送る行は DB が断る', async () => {
        await expect(
            directMessageRepository.create({ senderId: ids.a, recipientId: ids.a, content: 'x' }, T0),
        ).rejects.toThrow();
    });

    it('2 人の間を両方向あわせて新しい順に読み、ほかの人の分は混ぜない', async () => {
        const rows = await directMessageRepository.listBetween(ids.a, ids.b, { limit: 10 });
        expect(rows.map((r) => r.content).sort()).toEqual(['a→b 1', 'b→a 1', 'b→a 2']);
        expect(rows[0]?.createdAt.getTime()).toBe(at(2).getTime());
        expect(rows.at(-1)?.content).toBe('a→b 1');
    });

    it('同じ時刻の行もカーソルで重ならず漏れずにたどれる', async () => {
        const first = await directMessageRepository.listBetween(ids.a, ids.b, { limit: 1 });
        const top = first[0];
        if (!top) throw new Error('empty');
        const rest = await directMessageRepository.listBetween(ids.a, ids.b, {
            limit: 10,
            before: { publishedMs: top.createdAt.getTime(), id: top.id },
        });
        expect([top, ...rest].map((r) => r.id).sort()).toEqual(
            (await directMessageRepository.listBetween(ids.a, ids.b, { limit: 10 })).map((r) => r.id).sort(),
        );
        expect(rest.map((r) => r.id)).not.toContain(top.id);
    });

    it('会話の一覧は相手ごとに最新の 1 通と未読の数（新しい順）。limit で切る', async () => {
        const list = await directMessageRepository.conversationsOf(ids.a, 10);
        expect(list.map((c) => [c.peerId, c.last.content, c.unreadCount])).toEqual([
            [ids.c, 'c→a 1', 1],
            [ids.b, expect.stringMatching(/^b→a/), 2],
        ]);
        expect((await directMessageRepository.conversationsOf(ids.b, 10))[0]?.unreadCount).toBe(1);
        expect(await directMessageRepository.conversationsOf(ids.a, 1)).toHaveLength(1);
    });

    it('既読は受け手と送り手の組だけ。2 度目は 0', async () => {
        expect(await directMessageRepository.markReadFrom(ids.a, ids.b, at(10))).toBe(2);
        expect(await directMessageRepository.markReadFrom(ids.a, ids.b, at(11))).toBe(0);
        const list = await directMessageRepository.conversationsOf(ids.a, 10);
        expect(list.map((c) => c.unreadCount)).toEqual([1, 0]);
    });

    it('古いものだけを消し、ユーザーが消えたら会話も消える', async () => {
        await directMessageRepository.create({ senderId: ids.gone, recipientId: ids.a, content: 'old' }, at(-100));
        await directMessageRepository.deleteExpired(at(0));
        expect(await directMessageRepository.listBetween(ids.a, ids.gone, { limit: 10 })).toEqual([]);
        await directMessageRepository.create({ senderId: ids.gone, recipientId: ids.a, content: 'new' }, at(5));
        await userRepository.deleteById(ids.gone);
        expect(await directMessageRepository.listBetween(ids.a, ids.gone, { limit: 10 })).toEqual([]);
        expect((await directMessageRepository.listBetween(ids.a, ids.b, { limit: 10 })).length).toBe(3);
    });

    it('通知の種類に Create（メッセージ）を書ける', async () => {
        const n = await notificationRepository.create(
            {
                recipientId: ids.b,
                type: 'Create',
                actorUserId: ids.a,
                object: { type: 'Note', id: 'm', content: 'x' },
                dedupeKey: `Create:${ids.a}`,
            },
            T0,
        );
        expect(n?.type).toBe('Create');
    });
});
