import { describe, expect, it } from 'vitest';
import { sampleNotification } from './notificationBusContract';
import { createNotificationHub } from './notificationHub';
import { openNotificationStream, type SseSink, sseFrame, type Timers } from './notificationStream';

/** 時計を手で進めるタイマー。 */
function fakeTimers() {
    const state = { now: 0, seq: 0 };
    const tasks = new Map<number, { at: number; every?: number; fn: () => void }>();
    const timers: Timers = {
        setInterval: (fn, ms) => {
            state.seq += 1;
            tasks.set(state.seq, { at: state.now + ms, every: ms, fn });
            return state.seq;
        },
        clearInterval: (h) => tasks.delete(h as number),
        setTimeout: (fn, ms) => {
            state.seq += 1;
            tasks.set(state.seq, { at: state.now + ms, fn });
            return state.seq;
        },
        clearTimeout: (h) => tasks.delete(h as number),
    };
    const advance = (ms: number): void => {
        const end = state.now + ms;
        const due = () => [...tasks].filter(([, t]) => t.at <= end).sort((x, y) => x[1].at - y[1].at)[0];
        const runDue = (): void => {
            const next = due();
            if (!next) return;
            const [id, task] = next;
            state.now = task.at;
            if (task.every) tasks.set(id, { ...task, at: task.at + task.every });
            else tasks.delete(id);
            task.fn();
            runDue();
        };
        runDue();
        state.now = end;
    };
    return { timers, advance, pending: () => tasks.size };
}

function fakeSink() {
    const chunks: string[] = [];
    const state = { ended: false, onClose: undefined as (() => void) | undefined };
    const sink: SseSink = {
        write: (c) => chunks.push(c),
        end: () => {
            state.ended = true;
        },
        onClose: (l) => {
            state.onClose = l;
        },
    };
    return { sink, chunks, state, disconnect: () => state.onClose?.() };
}

describe('sseFrame', () => {
    it('event の名前と 1 行の JSON にする（本文の改行で枠が壊れない）', () => {
        const n = sampleNotification('n1');
        const frame = sseFrame({
            type: 'notification',
            notification: { ...n, actor: { ...n.actor, name: 'a\n\nevent: read' } },
        });
        expect(frame.startsWith('event: notification\ndata: ')).toBe(true);
        expect(frame.endsWith('\n\n')).toBe(true);
        expect(frame.slice(0, -2).split('\n')).toHaveLength(2);
    });
});

describe('openNotificationStream', () => {
    it('最初に retry を書き、届いた出来事を書き、25 秒ごとに keep-alive を流す', async () => {
        const { timers, advance } = fakeTimers();
        const { sink, chunks } = fakeSink();
        const hub = createNotificationHub({ maxConnectionsPerUser: 5 });
        openNotificationStream({ userId: 'bob', sink, hub, timers });
        expect(chunks[0]).toMatch(/^retry: 5000\n/);
        await hub.deliver('bob', { type: 'read' });
        expect(chunks.at(-1)).toBe('event: read\ndata: {"type":"read"}\n\n');
        advance(75_000);
        expect(chunks.filter((c) => c === ': keep-alive\n\n')).toHaveLength(3);
    });

    it('クライアントが切ったら hub から外れ、そのあとの出来事は書かない', async () => {
        const { timers, pending } = fakeTimers();
        const { sink, chunks, disconnect } = fakeSink();
        const hub = createNotificationHub({ maxConnectionsPerUser: 5 });
        openNotificationStream({ userId: 'bob', sink, hub, timers });
        disconnect();
        const before = chunks.length;
        await hub.deliver('bob', { type: 'read' });
        expect(chunks).toHaveLength(before);
        expect(hub.connectionCount('bob')).toBe(0);
        expect(pending()).toBe(0);
    });

    it('上限の時間で閉じる（繋ぎ直しで認証し直させる）', () => {
        const { timers, advance } = fakeTimers();
        const { sink, state } = fakeSink();
        const hub = createNotificationHub({ maxConnectionsPerUser: 5 });
        openNotificationStream({ userId: 'bob', sink, hub, timers, maxLifetimeMs: 60_000 });
        advance(59_999);
        expect(state.ended).toBe(false);
        advance(1);
        expect(state.ended).toBe(true);
        expect(hub.connectionCount()).toBe(0);
    });

    it('接続の上限で追い出された古い接続は閉じる', () => {
        const { timers } = fakeTimers();
        const hub = createNotificationHub({ maxConnectionsPerUser: 1 });
        const first = fakeSink();
        const second = fakeSink();
        openNotificationStream({ userId: 'bob', sink: first.sink, hub, timers });
        openNotificationStream({ userId: 'bob', sink: second.sink, hub, timers });
        expect(first.state.ended).toBe(true);
        expect(second.state.ended).toBe(false);
        expect(hub.connectionCount('bob')).toBe(1);
    });
});
