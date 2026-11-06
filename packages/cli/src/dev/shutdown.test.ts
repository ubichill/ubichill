import { describe, expect, it, vi } from 'vitest';
import { handleShutdown, type ShutdownSignal } from './shutdown.ts';

const signals = () => {
    const listeners = new Map<ShutdownSignal, (() => void)[]>();
    return {
        on: (signal: ShutdownSignal, listener: () => void) =>
            void listeners.set(signal, [...(listeners.get(signal) ?? []), listener]),
        emit: (signal: ShutdownSignal) => {
            for (const listener of listeners.get(signal) ?? []) listener();
        },
        count: (signal: ShutdownSignal) => listeners.get(signal)?.length ?? 0,
        exit: vi.fn<(code: number) => void>(),
    };
};

describe('handleShutdown', () => {
    it('npm が転送した 2 回目の SIGINT・続く SIGTERM でも、止める処理は 1 回だけ（受け手は外さない）', async () => {
        const bus = signals();
        const finish = Promise.withResolvers<void>();
        const stop = vi.fn(() => finish.promise);
        const shutdown = handleShutdown(stop, bus);
        expect(shutdown.started).toBe(false);

        bus.emit('SIGINT');
        bus.emit('SIGINT');
        bus.emit('SIGTERM');
        expect(stop).toHaveBeenCalledTimes(1);
        expect(bus.count('SIGINT')).toBe(1);
        expect(bus.count('SIGTERM')).toBe(1);
        expect(shutdown.started).toBe(true);

        // 止めている途中に呼んだ側も、同じ終わりを待てる
        const waiting = shutdown.trigger();
        expect(bus.exit).not.toHaveBeenCalled();
        finish.resolve();
        await expect(waiting).resolves.toBeUndefined();
        expect(stop).toHaveBeenCalledTimes(1);
        await vi.waitFor(() => expect(bus.exit).toHaveBeenCalledWith(0));
    });

    it('片付けに失敗したら 1 で抜ける', async () => {
        const bus = signals();
        handleShutdown(() => Promise.reject(new Error('Go が止まらない')), bus);
        bus.emit('SIGTERM');
        await vi.waitFor(() => expect(bus.exit).toHaveBeenCalledWith(1));
    });

    it('起動の失敗で片付けるとき（trigger を直接呼ぶ）は抜けない。失敗を呼び出し側が伝えられる', async () => {
        const bus = signals();
        const shutdown = handleShutdown(async () => undefined, bus);
        await shutdown.trigger();
        expect(bus.exit).not.toHaveBeenCalled();
    });
});
