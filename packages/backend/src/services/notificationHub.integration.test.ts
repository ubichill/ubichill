import { randomBytes } from 'node:crypto';
import { createClient } from '@redis/client';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { notificationBusContract } from './notificationBusContract';
import { createRedisNotificationBus, type NotificationBus } from './notificationHub';

/**
 * Redis の Pub/Sub で、別の台に繋いだ人に通知が届くか。REDIS_URL がある時だけ走る。ローカル実行例:
 *   docker run -d --rm --name ubichill-redis-test -p 127.0.0.1:6390:6379 redis:7-alpine
 *   REDIS_URL=redis://127.0.0.1:6390 pnpm exec vitest run packages/backend/src/services/notificationHub
 */
const RUN = !!process.env.REDIS_URL;

describe.skipIf(!RUN)('createRedisNotificationBus (Redis統合)', () => {
    const opened: Array<{ close(): Promise<void> }> = [];
    const buses: NotificationBus[] = [];
    const run = randomBytes(6).toString('hex');
    const counter = { next: 0 };
    const log = { warn: vi.fn(), info: vi.fn() };

    const replica = async (channel: string) => {
        const publisher = createClient({
            url: process.env.REDIS_URL,
            password: process.env.REDIS_PASSWORD || undefined,
        });
        const subscriber = publisher.duplicate();
        opened.push(publisher, subscriber);
        await publisher.connect();
        await subscriber.connect();
        const bus = createRedisNotificationBus({ publisher, subscriber, log, channel });
        buses.push(bus);
        return { bus, publisher };
    };

    afterAll(async () => {
        await Promise.all(buses.map((bus) => bus.close()));
        await Promise.all(opened.map((c) => c.close()));
    });

    notificationBusContract(async () => {
        counter.next += 1;
        const channel = `ubi:test:notifications:${run}:${counter.next}`;
        return { a: (await replica(channel)).bus, b: (await replica(channel)).bus };
    });

    it('形の違うメッセージは捨てる（ほかの台が古い版でも落ちない）', async () => {
        const channel = `ubi:test:notifications:${run}:bad`;
        const { bus, publisher } = await replica(channel);
        const got: unknown[] = [];
        await bus.subscribe((d) => got.push(d));
        await publisher.publish(channel, 'not json');
        await publisher.publish(channel, JSON.stringify({ to: 'bob', event: { type: 'unknown' } }));
        await new Promise((r) => setTimeout(r, 100));
        expect(got).toEqual([]);
        expect(log.warn).toHaveBeenCalled();
    });
});
