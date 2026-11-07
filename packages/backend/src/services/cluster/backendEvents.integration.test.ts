import { randomBytes } from 'node:crypto';
import { createClient } from '@redis/client';
import { afterAll, describe, vi } from 'vitest';
import { backendBusContract } from './backendBusContract';
import { type BackendBus, createRedisBackendBus } from './backendEvents';

/** Redis の Pub/Sub で 2 つの backend の間を知らせが届くか。REDIS_URL がある時だけ走る（実行例は lease.integration.test.ts）。 */
const RUN = !!process.env.REDIS_URL;

describe.skipIf(!RUN)('createRedisBackendBus (Redis統合)', () => {
    const opened: Array<{ close(): Promise<void> }> = [];
    const closers: BackendBus[] = [];
    const run = randomBytes(6).toString('hex');
    const counter = { next: 0 };

    /** backend 1 台ぶん（命令用の接続と、duplicate した購読用の接続）。 */
    const replica = async (channel: string): Promise<BackendBus> => {
        const publisher = createClient({
            url: process.env.REDIS_URL,
            password: process.env.REDIS_PASSWORD || undefined,
        });
        const subscriber = publisher.duplicate();
        opened.push(publisher, subscriber);
        await publisher.connect();
        await subscriber.connect();
        const bus = createRedisBackendBus({ publisher, subscriber, log: { warn: vi.fn(), info: vi.fn() }, channel });
        closers.push(bus);
        return bus;
    };

    afterAll(async () => {
        await Promise.all(closers.map((bus) => bus.close()));
        await Promise.all(opened.map((c) => c.close()));
    });

    backendBusContract(async () => {
        counter.next += 1;
        const channel = `ubi:test:ch:${run}:${counter.next}`;
        return { a: await replica(channel), b: await replica(channel) };
    });
});
