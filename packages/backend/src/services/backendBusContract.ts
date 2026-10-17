import { setTimeout as sleep } from 'node:timers/promises';
import { expect, it } from 'vitest';
import type { BackendBus, BackendEvent } from './backendEvents';

/** 同じ相手（同じ hub・同じ Redis のチャンネル）を見る 2 つの backend の口。 */
export interface BusPairUnderTest {
    a: BackendBus;
    b: BackendBus;
}

const waitFor = async (predicate: () => boolean, timeoutMs = 2000): Promise<void> => {
    const deadline = Date.now() + timeoutMs;
    while (!predicate() && Date.now() < deadline) await sleep(10);
};

/** メモリ（同じプロセスの hub）と Redis の Pub/Sub に同じ振る舞いを求めるテスト群。describe の中で呼ぶ。 */
export function backendBusContract(create: () => Promise<BusPairUnderTest>): void {
    it('相手には届き、自分には届かない', async () => {
        const { a, b } = await create();
        const gotA: BackendEvent[] = [];
        const gotB: BackendEvent[] = [];
        await a.subscribe((e) => gotA.push(e));
        await b.subscribe((e) => gotB.push(e));
        await a.publish({ type: 'world.changed', worldId: 'w1' });
        await waitFor(() => gotB.length > 0);
        expect(gotB).toEqual([{ type: 'world.changed', worldId: 'w1' }]);
        await sleep(50);
        expect(gotA).toEqual([]);
    });

    it('送った順に届く', async () => {
        const { a, b } = await create();
        const got: BackendEvent[] = [];
        await b.subscribe((e) => got.push(e));
        await a.publish({ type: 'remote.changed', url: 'https://example.com/1' });
        await a.publish({ type: 'peers.changed' });
        await a.publish({ type: 'favorites.changed', userId: 'u1' });
        await waitFor(() => got.length >= 3);
        expect(got.map((e) => e.type)).toEqual(['remote.changed', 'peers.changed', 'favorites.changed']);
    });

    it('閉じたら届かない', async () => {
        const { a, b } = await create();
        const got: BackendEvent[] = [];
        await b.subscribe((e) => got.push(e));
        await b.close();
        await a.publish({ type: 'worlds.reload' });
        await sleep(100);
        expect(got).toEqual([]);
    });
}
