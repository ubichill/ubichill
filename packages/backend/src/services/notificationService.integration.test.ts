import { randomBytes } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { createClient } from '@redis/client';
import { announcementRepository, notificationRepository, userRepository } from '@ubichill/db';
import type { NotificationStreamEvent } from '@ubichill/shared';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createNotificationHub, createRedisNotificationBus } from './notificationHub';
import { createNotificationService } from './notifications';

/**
 * 2 台の backend（それぞれの hub）と本物の DB・Redis で、通知が別の台の SSE に届き、切れている間の通知は一覧で取り直せるか。
 * DATABASE_URL と REDIS_URL がある時だけ走る。
 */
const RUN = !!process.env.DATABASE_URL && !!process.env.REDIS_URL;
const stamp = Date.now().toString(36);
const ids = { alice: `ns-a-${stamp}`, bob: `ns-b-${stamp}` };

describe.skipIf(!RUN)('通知の配送（DB・Redis 統合）', () => {
    const clients: Array<{ close(): Promise<void> }> = [];
    const channel = `ubi:test:notifications:${randomBytes(6).toString('hex')}`;

    const replica = async () => {
        const publisher = createClient({ url: process.env.REDIS_URL });
        const subscriber = publisher.duplicate();
        clients.push(publisher, subscriber);
        await Promise.all([publisher.connect(), subscriber.connect()]);
        const hub = createNotificationHub({ maxConnectionsPerUser: 5 });
        await hub.attach(
            createRedisNotificationBus({ publisher, subscriber, log: { warn: vi.fn(), info: vi.fn() }, channel }),
        );
        const service = createNotificationService({
            notifications: notificationRepository,
            announcements: announcementRepository,
            hub,
        });
        return { hub, service };
    };

    beforeAll(async () => {
        for (const [key, id] of Object.entries(ids)) {
            await userRepository.create({
                id,
                name: key,
                email: `${id}@example.com`,
                handle: `ns${key}_${stamp}`.slice(0, 30),
            });
        }
    });

    afterAll(async () => {
        for (const id of Object.values(ids)) await userRepository.deleteById(id);
        await Promise.all(clients.map((c) => c.close()));
    });

    it('台 A で作った申請の通知が、台 B に繋いだ相手の SSE に届く', async () => {
        const [a, b] = [await replica(), await replica()];
        const got: NotificationStreamEvent[] = [];
        b.hub.connect(ids.bob, { send: (e) => got.push(e), close: () => undefined });
        const created = await a.service.followRequested(ids.alice, ids.bob);
        const deadline = Date.now() + 2000;
        while (got.length === 0 && Date.now() < deadline) await sleep(10);
        expect(got).toEqual([{ type: 'notification', notification: created }]);
    });

    it('切れている間に作られた通知は届かず、繋ぎ直して一覧を取り直せば追いつく', async () => {
        const [a, b] = [await replica(), await replica()];
        const got: NotificationStreamEvent[] = [];
        const disconnect = b.hub.connect(ids.alice, { send: (e) => got.push(e), close: () => undefined });
        disconnect();
        const accepted = await a.service.friendAccepted(ids.bob, ids.alice);
        await sleep(100);
        expect(got).toEqual([]);
        const feed = await b.service.listFeed(ids.alice, {});
        expect(feed.ok && feed.items.map((i) => i.id)).toContain(accepted?.id);
        expect(await b.service.unreadCount(ids.alice)).toBeGreaterThanOrEqual(1);
    });
});
