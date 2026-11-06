import { setTimeout as sleep } from 'node:timers/promises';
import type { AppNotification } from '@ubichill/shared';
import { expect, it } from 'vitest';
import { createNotificationHub, type NotificationBus } from './notificationHub';

/** 同じ相手（同じ hub・同じ Redis のチャンネル）を見る 2 台の backend の口。 */
export interface NotificationBusPair {
    a: NotificationBus;
    b: NotificationBus;
}

const waitFor = async (predicate: () => boolean, timeoutMs = 2000): Promise<void> => {
    const deadline = Date.now() + timeoutMs;
    while (!predicate() && Date.now() < deadline) await sleep(10);
};

export const sampleNotification = (id: string, recipient = 'bob'): AppNotification => ({
    id,
    type: 'Follow',
    actor: { type: 'Person', id: 'alice', name: 'Alice', preferredUsername: 'alice', icon: null },
    object: { type: 'Person', id: recipient },
    published: '2026-10-01T00:00:00.000Z',
    read: false,
});

/** メモリと Redis の Pub/Sub に同じ振る舞いを求める。describe の中で呼ぶ。 */
export function notificationBusContract(create: () => Promise<NotificationBusPair>): void {
    it('送った台を含む全台に届く', async () => {
        const { a, b } = await create();
        const gotA: string[] = [];
        const gotB: string[] = [];
        await a.subscribe((d) => gotA.push(d.to));
        await b.subscribe((d) => gotB.push(d.to));
        await a.publish({ to: 'bob', event: { type: 'read' } });
        await waitFor(() => gotA.length > 0 && gotB.length > 0);
        expect(gotA).toEqual(['bob']);
        expect(gotB).toEqual(['bob']);
    });

    it('別の台に繋いだ人に届き、宛先でない人には届かない', async () => {
        const { a, b } = await create();
        const hubA = createNotificationHub({ maxConnectionsPerUser: 5 });
        const hubB = createNotificationHub({ maxConnectionsPerUser: 5 });
        await hubA.attach(a);
        await hubB.attach(b);
        const bob: string[] = [];
        const carol: string[] = [];
        hubB.connect('bob', { send: (e) => bob.push(e.type), close: () => undefined });
        hubB.connect('carol', { send: (e) => carol.push(e.type), close: () => undefined });
        await hubA.deliver('bob', { type: 'notification', notification: sampleNotification('n1') });
        await waitFor(() => bob.length > 0);
        await sleep(50);
        expect(bob).toEqual(['notification']);
        expect(carol).toEqual([]);
    });

    it('全員宛て（お知らせ）は両方の台の全員に、1 回ずつ届く', async () => {
        const { a, b } = await create();
        const hubA = createNotificationHub({ maxConnectionsPerUser: 5 });
        const hubB = createNotificationHub({ maxConnectionsPerUser: 5 });
        await hubA.attach(a);
        await hubB.attach(b);
        const got: string[] = [];
        hubA.connect('alice', { send: () => got.push('alice'), close: () => undefined });
        hubB.connect('bob', { send: () => got.push('bob'), close: () => undefined });
        await hubB.deliver('*', { type: 'read' });
        await waitFor(() => got.length >= 2);
        await sleep(50);
        expect(got.sort()).toEqual(['alice', 'bob']);
    });

    it('閉じたら届かない', async () => {
        const { a, b } = await create();
        const got: string[] = [];
        await b.subscribe((d) => got.push(d.to));
        await b.close();
        await a.publish({ to: 'bob', event: { type: 'read' } });
        await sleep(100);
        expect(got).toEqual([]);
    });
}
