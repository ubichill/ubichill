import { setTimeout as sleep } from 'node:timers/promises';
import { describe, expect, it, vi } from 'vitest';
import { backendBusContract } from './backendBusContract';
import { type BackendEvent, createBackendEvents, createMemoryBusHub, createRedisBackendBus } from './backendEvents';

describe('createMemoryBusHub', () => {
    backendBusContract(async () => {
        const hub = createMemoryBusHub();
        return { a: hub.connect(), b: hub.connect() };
    });
});

/** Redis を使わずに Redis 実装の受け取り側を確かめる（届いた文字列をそのまま listener に渡す）。 */
const fakeRedis = () => {
    const listeners = new Map<string, (message: string) => void>();
    return {
        listeners,
        publisher: { sendCommand: vi.fn(async (_args: ReadonlyArray<string>): Promise<unknown> => 1) },
        subscriber: {
            subscribe: vi.fn(async (channel: string, listener: (message: string) => void) => {
                listeners.set(channel, listener);
            }),
            unsubscribe: vi.fn(async (channel: string) => {
                listeners.delete(channel);
            }),
        },
    };
};

describe('createRedisBackendBus', () => {
    it('読めない知らせ・形の違う知らせは捨て、処理を止めない', async () => {
        const redis = fakeRedis();
        const log = { warn: vi.fn(), info: vi.fn() };
        const bus = createRedisBackendBus({ ...redis, log, channel: 'ch' });
        const got: BackendEvent[] = [];
        await bus.subscribe((e) => got.push(e));
        const deliver = redis.listeners.get('ch');
        deliver?.('not json');
        deliver?.(JSON.stringify({ origin: 'x', event: { type: 'world.changed' } }));
        deliver?.(JSON.stringify({ origin: 'x', event: { type: 'unknown.event' } }));
        deliver?.(JSON.stringify({ origin: 'x', event: { type: 'world.changed', worldId: 'ok' } }));
        expect(got).toEqual([{ type: 'world.changed', worldId: 'ok' }]);
        expect(log.warn).toHaveBeenCalledTimes(3);
    });

    it('購読は 1 回だけ（受け手が増えても接続の購読を重ねない）', async () => {
        const redis = fakeRedis();
        const bus = createRedisBackendBus({ ...redis, log: { warn: vi.fn(), info: vi.fn() } });
        await bus.subscribe(() => {});
        await bus.subscribe(() => {});
        expect(redis.subscriber.subscribe).toHaveBeenCalledTimes(1);
    });

    it('Redis が落ちていて送れなくても失敗にせず、警告は 1 回だけ', async () => {
        const redis = fakeRedis();
        redis.publisher.sendCommand.mockRejectedValue(new Error('The client is closed'));
        const log = { warn: vi.fn(), info: vi.fn() };
        const bus = createRedisBackendBus({ ...redis, log });
        await expect(bus.publish({ type: 'worlds.reload' })).resolves.toBeUndefined();
        await expect(bus.publish({ type: 'worlds.reload' })).resolves.toBeUndefined();
        expect(log.warn).toHaveBeenCalledTimes(1);
    });
});

describe('createBackendEvents', () => {
    it('運ぶ口を付けていなければ、知らせても何も起きない（Redis なし）', () => {
        const events = createBackendEvents({ warn: vi.fn() });
        expect(() => events.broadcast({ type: 'peers.changed' })).not.toThrow();
    });

    it('2 つの backend: 片方の知らせが、もう片方の種類の合う受け手だけに届く', async () => {
        const hub = createMemoryBusHub();
        const a = createBackendEvents({ warn: vi.fn() });
        const b = createBackendEvents({ warn: vi.fn() });
        await a.attach(hub.connect());
        await b.attach(hub.connect());
        const dropped: string[] = [];
        const peers = vi.fn();
        b.on('world.changed', ({ worldId }) => void dropped.push(worldId));
        b.on('peers.changed', peers);
        a.broadcast({ type: 'world.changed', worldId: 'w1' });
        await sleep(10);
        expect(dropped).toEqual(['w1']);
        expect(peers).not.toHaveBeenCalled();
    });

    it('受け手の失敗はほかの受け手を止めず、警告にする', async () => {
        const hub = createMemoryBusHub();
        const a = createBackendEvents({ warn: vi.fn() });
        const warn = vi.fn();
        const b = createBackendEvents({ warn });
        await a.attach(hub.connect());
        await b.attach(hub.connect());
        const ok = vi.fn();
        b.on('worlds.reload', async () => {
            throw new Error('boom');
        });
        b.on('worlds.reload', ok);
        a.broadcast({ type: 'worlds.reload' });
        await sleep(10);
        expect(ok).toHaveBeenCalledTimes(1);
        expect(warn).toHaveBeenCalledTimes(1);
    });

    it('外したら届かない', async () => {
        const hub = createMemoryBusHub();
        const a = createBackendEvents({ warn: vi.fn() });
        const b = createBackendEvents({ warn: vi.fn() });
        await a.attach(hub.connect());
        await b.attach(hub.connect());
        const got = vi.fn();
        b.on('worlds.reload', got);
        await b.detach();
        a.broadcast({ type: 'worlds.reload' });
        await sleep(10);
        expect(got).not.toHaveBeenCalled();
    });
});
