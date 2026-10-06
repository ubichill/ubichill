import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InstanceJoinRejected, InstanceSocket, type ResolveInstance } from './instanceSocket';

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
    it('パスワードはチケット取得にだけ使い、インスタンスサーバーへ送らない', async () => {
        const resolve = vi.fn<ResolveInstance>(async () => grant);
        const socket = new InstanceSocket(resolve);
        socket.emit('world:join', { instanceId: 'room', password: 'secret-pw', user: { ...user } }, vi.fn());
        await flush();
        latest().open();
        expect(resolve).toHaveBeenCalledWith('room', 'secret-pw', expect.any(AbortSignal));
        expect(latest().frames[0]?.data).not.toHaveProperty('password');
        expect(Object.keys(latest().frames[0]?.data as object).sort()).toEqual(['instanceId', 'token', 'user']);
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

    it('HTTPが応答しなくても30秒で中断し、遅れて返るチケットを使わない', async () => {
        const pending = Promise.withResolvers<typeof grant>();
        const resolve = vi.fn<ResolveInstance>(() => pending.promise);
        const socket = new InstanceSocket(resolve);
        const joined = vi.fn();
        socket.emit('world:join', { instanceId: 'room', user }, joined);
        await flush();
        const signal = resolve.mock.calls[0]?.[2];
        await vi.advanceTimersByTimeAsync(29999);
        expect(joined).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(signal?.aborted).toBe(true);
        expect(joined).toHaveBeenCalledOnce();
        expect(socket.connecting).toBe(false);
        pending.resolve(grant);
        await flush();
        await vi.advanceTimersByTimeAsync(120000);
        expect(FakeWebSocket.instances).toHaveLength(0);
        expect(resolve).toHaveBeenCalledOnce();
    });

    it('WebSocketが開かなくても30秒以内に失敗を返し、再接続を止める', async () => {
        const resolve = vi.fn<ResolveInstance>(async () => grant);
        const socket = new InstanceSocket(resolve);
        const joined = vi.fn();
        socket.emit('world:join', { instanceId: 'room', user }, joined);
        await flush();
        await vi.advanceTimersByTimeAsync(30000);
        expect(joined).toHaveBeenCalledOnce();
        expect(socket.connecting).toBe(false);
        const attempts = resolve.mock.calls.length;
        await vi.advanceTimersByTimeAsync(120000);
        expect(resolve).toHaveBeenCalledTimes(attempts);
        expect(latest().readyState).toBe(3);
    });

    it('入室直後に切断を繰り返しても再試行上限をリセットしない', async () => {
        const resolve = vi.fn<ResolveInstance>(async () => grant);
        const socket = new InstanceSocket(resolve);
        const joined = vi.fn();
        socket.emit('world:join', { instanceId: 'room', user }, joined);
        await flush();
        for (const delay of [1000, 2000, 4000, 8000, 10000]) {
            latest().open();
            ackJoin(latest());
            latest().close();
            await vi.advanceTimersByTimeAsync(delay);
        }
        latest().open();
        ackJoin(latest());
        latest().close();
        await vi.advanceTimersByTimeAsync(120000);
        expect(resolve).toHaveBeenCalledTimes(6);
        const failures = joined.mock.calls.filter(([result]) => !result.success);
        expect(failures).toHaveLength(1);
        expect(socket.connected).toBe(false);
        expect(socket.connecting).toBe(false);
    });

    it('10秒安定した接続の切断後は新しい復旧上限を使う', async () => {
        const resolve = vi.fn<ResolveInstance>(async () => grant);
        const socket = new InstanceSocket(resolve);
        const joined = vi.fn();
        socket.emit('world:join', { instanceId: 'room', user }, joined);
        await flush();
        latest().open();
        ackJoin(latest());
        await vi.advanceTimersByTimeAsync(40000);
        expect(socket.connected).toBe(true);
        latest().close();
        await vi.advanceTimersByTimeAsync(1000);
        latest().open();
        ackJoin(latest());
        expect(resolve).toHaveBeenCalledTimes(2);
        expect(socket.connected).toBe(true);
        socket.disconnect();
    });

    it('退出は取得中のHTTPを中断して再試行も取り消す', async () => {
        const resolve = vi.fn<ResolveInstance>(() => new Promise(() => {}));
        const socket = new InstanceSocket(resolve);
        const joined = vi.fn();
        socket.emit('world:join', { instanceId: 'room', user }, joined);
        await flush();
        const signal = resolve.mock.calls[0]?.[2];
        socket.disconnect();
        expect(signal?.aborted).toBe(true);
        await vi.advanceTimersByTimeAsync(120000);
        expect(resolve).toHaveBeenCalledOnce();
        expect(joined).not.toHaveBeenCalled();
    });

    it('チケット失効は一度だけ取り直して入室できる', async () => {
        const resolve = vi
            .fn<ResolveInstance>()
            .mockResolvedValueOnce({ ...grant, token: 'ticket-1' })
            .mockResolvedValue({ ...grant, token: 'ticket-2' });
        const socket = new InstanceSocket(resolve);
        const joined = vi.fn();
        socket.emit('world:join', { instanceId: 'room', user }, joined);
        await flush();
        latest().open();
        latest().receive({
            replyTo: latest().frames[0]?.id,
            data: { success: false, error: '失効', code: 'ticket_invalid' },
        });
        expect(joined).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1000);
        latest().open();
        expect(latest().frames[0]?.data).toMatchObject({ token: 'ticket-2' });
        ackJoin(latest());
        expect(resolve).toHaveBeenCalledTimes(2);
        expect(joined).toHaveBeenCalledOnce();
        expect(socket.connected).toBe(true);
        socket.disconnect();
    });

    it('チケットを取り直しても無効なら失敗にして止める', async () => {
        const resolve = vi.fn<ResolveInstance>(async () => grant);
        const socket = new InstanceSocket(resolve);
        const joined = vi.fn();
        socket.emit('world:join', { instanceId: 'room', user }, joined);
        await flush();
        for (const delay of [1000, 120000]) {
            latest().open();
            latest().receive({
                replyTo: latest().frames[0]?.id,
                data: { success: false, error: '失効', code: 'ticket_invalid' },
            });
            await vi.advanceTimersByTimeAsync(delay);
        }
        expect(resolve).toHaveBeenCalledTimes(2);
        expect(joined).toHaveBeenCalledOnce();
        expect(joined).toHaveBeenCalledWith({ success: false, error: '失効' });
    });

    it('部屋が消え続ける場合も接続上限で終了する', async () => {
        const resolve = vi.fn<ResolveInstance>(async () => grant);
        const socket = new InstanceSocket(resolve);
        const joined = vi.fn();
        socket.emit('world:join', { instanceId: 'room', user }, joined);
        await flush();
        for (const delay of [1000, 2000, 4000, 8000, 10000, 120000]) {
            latest().open();
            latest().receive({
                replyTo: latest().frames[0]?.id,
                data: { success: false, error: '部屋なし', code: 'instance_unavailable' },
            });
            await vi.advanceTimersByTimeAsync(delay);
        }
        expect(resolve).toHaveBeenCalledTimes(6);
        expect(joined).toHaveBeenCalledOnce();
    });

    describe('入室拒否', () => {
        it('拒否されたら一度だけ失敗を返し、再試行しない', async () => {
            const resolve = vi.fn<ResolveInstance>(async () => {
                throw new InstanceJoinRejected('パスワードが正しくありません');
            });
            const socket = new InstanceSocket(resolve);
            const joined = vi.fn();
            const connectError = vi.fn();
            socket.on('connect_error', connectError);
            socket.emit('world:join', { instanceId: 'room', user }, joined);
            await flush();
            await vi.advanceTimersByTimeAsync(60000);
            expect(joined).toHaveBeenCalledOnce();
            expect(joined).toHaveBeenCalledWith({ success: false, error: 'パスワードが正しくありません' });
            expect(resolve).toHaveBeenCalledOnce();
            expect(connectError).not.toHaveBeenCalled();
            expect(FakeWebSocket.instances).toHaveLength(0);
        });
        it('再接続中に拒否されたら（削除・権限変更）参加失敗として返し、再接続をやめる', async () => {
            const resolve = vi
                .fn<ResolveInstance>()
                .mockResolvedValueOnce(grant)
                .mockRejectedValue(new InstanceJoinRejected('このインスタンスには入れません'));
            const socket = new InstanceSocket(resolve);
            const joined = vi.fn();
            socket.emit('world:join', { instanceId: 'room', user: { ...user } }, joined);
            await flush();
            latest().open();
            ackJoin(latest());
            latest().close();
            await vi.advanceTimersByTimeAsync(60000);
            expect(resolve).toHaveBeenCalledTimes(2);
            expect(joined).toHaveBeenCalledTimes(2);
            expect(joined).toHaveBeenLastCalledWith({ success: false, error: 'このインスタンスには入れません' });
            expect(socket.connected).toBe(false);
        });
        it('一時的な失敗は上限まで再試行し、超えたら一度だけ失敗にする', async () => {
            const resolve = vi.fn<ResolveInstance>().mockRejectedValue(new Error('Instance runtime: 503'));
            const socket = new InstanceSocket(resolve);
            const joined = vi.fn();
            const connectError = vi.fn();
            socket.on('connect_error', connectError);
            socket.emit('world:join', { instanceId: 'room', user }, joined);
            await flush();
            await vi.advanceTimersByTimeAsync(1000 + 2000 + 4000 + 8000);
            expect(resolve).toHaveBeenCalledTimes(5);
            expect(joined).not.toHaveBeenCalled();
            await vi.advanceTimersByTimeAsync(10000);
            expect(resolve).toHaveBeenCalledTimes(6);
            expect(connectError).toHaveBeenCalledTimes(6);
            expect(joined).toHaveBeenCalledOnce();
            expect(joined).toHaveBeenCalledWith({ success: false, error: expect.stringContaining('上限') });
            await vi.advanceTimersByTimeAsync(120000);
            expect(resolve).toHaveBeenCalledTimes(6);
            expect(joined).toHaveBeenCalledOnce();
            socket.disconnect();
        });
        it('一時的な失敗の後に拒否されたら、そこで止まる', async () => {
            const resolve = vi
                .fn<ResolveInstance>()
                .mockRejectedValueOnce(new Error('network'))
                .mockRejectedValue(new InstanceJoinRejected('このインスタンスには入れません'));
            const socket = new InstanceSocket(resolve);
            const joined = vi.fn();
            socket.emit('world:join', { instanceId: 'room', user }, joined);
            await flush();
            await vi.advanceTimersByTimeAsync(60000);
            expect(resolve).toHaveBeenCalledTimes(2);
            expect(joined).toHaveBeenCalledOnce();
            expect(joined).toHaveBeenCalledWith({ success: false, error: 'このインスタンスには入れません' });
        });
        it('通信バージョンが違うサーバーには接続せず、参加失敗にする', async () => {
            const socket = new InstanceSocket(async () => ({ ...grant, protocolVersion: 2 as unknown as 1 }));
            const joined = vi.fn();
            socket.emit('world:join', { instanceId: 'room', user }, joined);
            await flush();
            await vi.advanceTimersByTimeAsync(60000);
            expect(FakeWebSocket.instances).toHaveLength(0);
            expect(joined).toHaveBeenCalledOnce();
            expect(joined.mock.calls[0]?.[0]).toMatchObject({ success: false });
        });
        it('サーバーが入室を拒否したら再接続しない', async () => {
            const socket = new InstanceSocket(async () => grant);
            const joined = vi.fn();
            socket.emit('world:join', { instanceId: 'room', user }, joined);
            await flush();
            latest().open();
            latest().receive({ replyTo: latest().frames[0]?.id, data: { success: false, error: '満員です' } });
            await vi.advanceTimersByTimeAsync(60000);
            expect(joined).toHaveBeenCalledOnce();
            expect(joined).toHaveBeenCalledWith({ success: false, error: '満員です' });
            expect(FakeWebSocket.instances).toHaveLength(1);
        });
        it('拒否された後も別の入室はやり直せる', async () => {
            const resolve = vi
                .fn<ResolveInstance>()
                .mockRejectedValueOnce(new InstanceJoinRejected('このインスタンスには入れません'))
                .mockResolvedValue(grant);
            const socket = new InstanceSocket(resolve);
            socket.emit('world:join', { instanceId: 'locked', user }, vi.fn());
            await flush();
            const joined = vi.fn();
            socket.emit('world:join', { instanceId: 'room', user }, joined);
            await flush();
            latest().open();
            ackJoin(latest());
            expect(joined).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
            expect(socket.connected).toBe(true);
            socket.disconnect();
        });
    });
});
