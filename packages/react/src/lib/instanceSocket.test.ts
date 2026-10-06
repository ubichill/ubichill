import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InstanceSocket, type ResolveInstance } from './instanceSocket';

class FakeWebSocket {
    static OPEN = 1;
    static instances: FakeWebSocket[] = [];
    readyState = 0;
    bufferedAmount = 0;
    frames: Array<{ event: string; data: unknown; id?: string }> = [];
    onopen?: () => void;
    onclose?: () => void;
    onmessage?: (event: { data: string }) => void;
    onerror?: () => void;
    constructor(public url: URL) {
        FakeWebSocket.instances.push(this);
    }
    send(raw: string) {
        this.frames.push(JSON.parse(raw));
    }
    open() {
        this.readyState = 1;
        this.onopen?.();
    }
    close() {
        if (this.readyState === 3) return;
        this.readyState = 3;
        this.onclose?.();
    }
    receive(value: unknown) {
        this.onmessage?.({ data: JSON.stringify(value) });
    }
}
const user = { name: 'Alice', status: 'online' as const, position: { x: 0, y: 0 }, lastActiveAt: 0 };
const grant = {
    url: 'https://runtime.test/realtime/v1/ws',
    token: 'secret',
    userId: 'alice',
    expiresAt: 99999,
    protocolVersion: 1 as const,
};
const latest = () => FakeWebSocket.instances.at(-1) as FakeWebSocket;
async function flush() {
    await Promise.resolve();
    await Promise.resolve();
}
function ackJoin(ws: FakeWebSocket) {
    ws.receive({ replyTo: ws.frames[0]?.id, data: { success: true, userId: 'alice', instanceId: 'room' } });
}

describe('InstanceSocket', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        FakeWebSocket.instances = [];
        vi.stubGlobal('WebSocket', FakeWebSocket);
        vi.stubGlobal('window', { location: { href: 'https://client.test/' } });
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });
    it('チケットをURLに含めず、入室応答後に接続済みになる', async () => {
        const socket = new InstanceSocket(async () => grant);
        const joined = vi.fn();
        const connected = vi.fn();
        socket.on('connect', connected);
        socket.emit('world:join', { instanceId: 'room', user: { ...user } }, joined);
        await flush();
        const ws = latest();
        expect(ws.url.href).toBe('wss://runtime.test/realtime/v1/ws');
        ws.open();
        expect(socket.connected).toBe(false);
        expect(ws.frames[0]?.data).toMatchObject({ token: 'secret', instanceId: 'room' });
        ackJoin(ws);
        expect(socket.connected).toBe(true);
        expect(joined).toHaveBeenCalledOnce();
        expect(connected).toHaveBeenCalledOnce();
        socket.disconnect();
    });
    it('再接続は新しいチケットと最新位置を使い、createを再送しない', async () => {
        const resolve = vi.fn<ResolveInstance>(async () => grant);
        const socket = new InstanceSocket(resolve);
        socket.emit('world:join', { instanceId: 'room', user: { ...user } }, vi.fn());
        await flush();
        latest().open();
        ackJoin(latest());
        socket.emit('cursor:move', { position: { x: 42, y: 20 } });
        socket.emit('entity:delete', 'unconfirmed');
        latest().close();
        await vi.advanceTimersByTimeAsync(1000);
        await flush();
        latest().open();
        expect(resolve).toHaveBeenCalledTimes(2);
        expect(latest().frames).toHaveLength(1);
        expect(latest().frames[0]?.data).toMatchObject({ user: { position: { x: 42, y: 20 } } });
        socket.disconnect();
    });
    it('接続前の退出は遅れて返った接続情報を破棄する', async () => {
        const pending = Promise.withResolvers<typeof grant>();
        const socket = new InstanceSocket(() => pending.promise);
        socket.emit('world:join', { instanceId: 'room', user }, vi.fn());
        socket.disconnect();
        pending.resolve(grant);
        await flush();
        expect(FakeWebSocket.instances).toHaveLength(0);
    });
    it('入室応答前の通信断からも復帰する', async () => {
        const socket = new InstanceSocket(async () => grant);
        socket.emit('world:join', { instanceId: 'room', user }, vi.fn());
        await flush();
        latest().open();
        latest().close();
        await vi.advanceTimersByTimeAsync(1000);
        await flush();
        expect(FakeWebSocket.instances).toHaveLength(2);
        socket.disconnect();
    });
    it('退出応答を待っている間の切断でもコールバックを一度だけ呼ぶ', async () => {
        const socket = new InstanceSocket(async () => grant);
        socket.emit('world:join', { instanceId: 'room', user }, vi.fn());
        await flush();
        latest().open();
        ackJoin(latest());
        const callback = vi.fn(() => socket.disconnect());
        socket.emit('world:leave', callback);
        latest().close();
        expect(callback).toHaveBeenCalledOnce();
    });
});
