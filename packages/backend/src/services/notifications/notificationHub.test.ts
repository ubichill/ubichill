import { describe, expect, it, vi } from 'vitest';
import { notificationBusContract, sampleNotification } from './notificationBusContract';
import { createMemoryNotificationBusHub, createNotificationHub, type NotificationBus } from './notificationHub';

describe('メモリの通知の bus', () => {
    notificationBusContract(async () => {
        const hub = createMemoryNotificationBusHub();
        return { a: hub.connect(), b: hub.connect() };
    });
});

describe('createNotificationHub', () => {
    const conn = (log: string[], name: string) => ({
        send: (e: { type: string }) => log.push(`${name}:${e.type}`),
        close: () => log.push(`${name}:closed`),
    });

    it('bus が無ければこの台の接続にだけ届ける', async () => {
        const hub = createNotificationHub({ maxConnectionsPerUser: 5 });
        const log: string[] = [];
        hub.connect('bob', conn(log, 'bob1'));
        hub.connect('bob', conn(log, 'bob2'));
        await hub.deliver('bob', { type: 'read' });
        await hub.deliver('alice', { type: 'read' });
        expect(log).toEqual(['bob1:read', 'bob2:read']);
    });

    it('切れた接続には書かない', async () => {
        const hub = createNotificationHub({ maxConnectionsPerUser: 5 });
        const log: string[] = [];
        const disconnect = hub.connect('bob', conn(log, 'bob'));
        disconnect();
        await hub.deliver('bob', { type: 'notification', notification: sampleNotification('n1') });
        expect(log).toEqual([]);
        expect(hub.connectionCount()).toBe(0);
    });

    it('1 人の接続の上限を超えたら、いちばん古い接続を閉じる', () => {
        const hub = createNotificationHub({ maxConnectionsPerUser: 2 });
        const log: string[] = [];
        hub.connect('bob', conn(log, 'c1'));
        hub.connect('bob', conn(log, 'c2'));
        hub.connect('bob', conn(log, 'c3'));
        expect(log).toEqual(['c1:closed']);
        expect(hub.connectionCount('bob')).toBe(2);
    });

    it('bus が送れなければ、この台の接続にだけは届ける（二重には届けない）', async () => {
        const failing: NotificationBus = {
            publish: vi.fn(async () => {
                throw new Error('Redis down');
            }),
            subscribe: vi.fn(async () => undefined),
            close: vi.fn(async () => undefined),
        };
        const hub = createNotificationHub({ maxConnectionsPerUser: 5 });
        await hub.attach(failing);
        const log: string[] = [];
        hub.connect('bob', conn(log, 'bob'));
        await hub.deliver('bob', { type: 'read' });
        expect(log).toEqual(['bob:read']);
    });

    it('bus があれば手元に直接は届けない（bus から戻ってきた 1 回だけ）', async () => {
        const bus = createMemoryNotificationBusHub();
        const hub = createNotificationHub({ maxConnectionsPerUser: 5 });
        await hub.attach(bus.connect());
        const log: string[] = [];
        hub.connect('bob', conn(log, 'bob'));
        await hub.deliver('bob', { type: 'read' });
        await new Promise((r) => setTimeout(r, 10));
        expect(log).toEqual(['bob:read']);
    });

    it('停止時に全部の接続を閉じ、そのあとは届けない', async () => {
        const hub = createNotificationHub({ maxConnectionsPerUser: 5 });
        const log: string[] = [];
        hub.connect('bob', conn(log, 'bob'));
        hub.connect('alice', conn(log, 'alice'));
        hub.closeAll();
        await hub.deliver('*', { type: 'read' });
        expect(log.sort()).toEqual(['alice:closed', 'bob:closed']);
        expect(hub.connectionCount()).toBe(0);
    });

    it('書けない接続があっても、ほかの接続には届ける', async () => {
        const hub = createNotificationHub({ maxConnectionsPerUser: 5, log: { warn: () => undefined } });
        const log: string[] = [];
        hub.connect('bob', {
            send: () => {
                throw new Error('EPIPE');
            },
            close: () => undefined,
        });
        hub.connect('bob', conn(log, 'ok'));
        await hub.deliver('bob', { type: 'read' });
        expect(log).toEqual(['ok:read']);
    });
});
