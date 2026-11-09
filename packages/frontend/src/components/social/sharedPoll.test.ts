import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSharedPoll } from './sharedPoll';

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function setup() {
    const calls: Array<{ resolve: (v: string) => void; reject: (e: Error) => void }> = [];
    const visible = { hidden: false, listeners: new Set<() => void>() };
    const poll = createSharedPoll<string>({
        load: () => new Promise<string>((resolve, reject) => calls.push({ resolve, reject })),
        intervalMs: 15_000,
        staleMs: 5_000,
        now: () => Date.now(),
        isHidden: () => visible.hidden,
        onVisible(callback) {
            visible.listeners.add(callback);
            return () => visible.listeners.delete(callback);
        },
    });
    return { poll, calls, visible };
}

describe('createSharedPoll', () => {
    beforeEach(() => vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] }));
    afterEach(() => vi.useRealTimers());

    it('画面がいくつ開いても読み込みは 1 つ。後から開いた画面は、新しい答えをそのまま使う', async () => {
        const { poll, calls } = setup();
        poll.setOwner('me');
        const offA = poll.subscribe(() => undefined);
        const offB = poll.subscribe(() => undefined);
        expect(calls).toHaveLength(1);
        calls[0]?.resolve('v1');
        await flush();
        const offC = poll.subscribe(() => undefined);
        expect(calls).toHaveLength(1);
        expect(poll.getSnapshot().data).toBe('v1');
        offA();
        offB();
        offC();
    });

    it('画面を移る（全部閉じてすぐ開く）ときも、新しい答えなら取り直さず、古ければ取り直す', async () => {
        const { poll, calls } = setup();
        poll.setOwner('me');
        poll.subscribe(() => undefined)();
        calls[0]?.resolve('v1');
        await flush();
        poll.subscribe(() => undefined)();
        expect(calls).toHaveLength(1);
        vi.advanceTimersByTime(5_000);
        poll.subscribe(() => undefined);
        expect(calls).toHaveLength(2);
    });

    it('見ている画面がある間だけ定期的に読み、隠れている間は読まない。だれも見なくなったら止まる', async () => {
        const { poll, calls, visible } = setup();
        poll.setOwner('me');
        const off = poll.subscribe(() => undefined);
        calls[0]?.resolve('v1');
        await flush();
        vi.advanceTimersByTime(15_000);
        expect(calls).toHaveLength(2);
        calls[1]?.resolve('v2');
        await flush();
        visible.hidden = true;
        vi.advanceTimersByTime(45_000);
        expect(calls).toHaveLength(2);
        visible.hidden = false;
        for (const l of visible.listeners) l();
        expect(calls).toHaveLength(3);
        calls[2]?.resolve('v3');
        await flush();
        off();
        vi.advanceTimersByTime(60_000);
        expect(calls).toHaveLength(3);
        expect(visible.listeners.size).toBe(0);
    });

    it('ログインしている人が変わったら前の答えを捨て、前の人の遅れて届いた答えは使わない', async () => {
        const { poll, calls } = setup();
        poll.setOwner('alice');
        poll.subscribe(() => undefined);
        poll.setOwner('bob');
        expect(poll.getSnapshot()).toEqual({ owner: 'bob', data: null, error: null });
        calls[0]?.resolve('alice のフレンド');
        await flush();
        expect(poll.getSnapshot().data).toBeNull();
        calls[1]?.resolve('bob のフレンド');
        await flush();
        expect(poll.getSnapshot()).toEqual({ owner: 'bob', data: 'bob のフレンド', error: null });
    });

    it('失敗しても前の答えは残し、理由を添える。次に成功したら理由を消す', async () => {
        const { poll, calls } = setup();
        poll.setOwner('me');
        poll.subscribe(() => undefined);
        calls[0]?.resolve('v1');
        await flush();
        void poll.reload();
        calls[1]?.reject(new Error('つながりません'));
        await flush();
        expect(poll.getSnapshot()).toMatchObject({ data: 'v1', error: 'つながりません' });
        void poll.reload();
        calls[2]?.resolve('v2');
        await flush();
        expect(poll.getSnapshot()).toMatchObject({ data: 'v2', error: null });
    });

    it('ログインを確かめる前（持ち主が無い）に開いても落ちない', () => {
        const { poll, calls } = setup();
        expect(() => poll.subscribe(() => undefined)).not.toThrow();
        expect(calls).toHaveLength(1);
    });

    it('答えが変わるたびに見ている画面に知らせる', async () => {
        const { poll, calls } = setup();
        poll.setOwner('me');
        const listener = vi.fn();
        poll.subscribe(listener);
        calls[0]?.resolve('v1');
        await flush();
        expect(listener).toHaveBeenCalled();
    });
});
