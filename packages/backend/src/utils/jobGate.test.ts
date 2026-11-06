import { describe, expect, it } from 'vitest';
import { createJobGate, JobGateFullError } from './jobGate';

const deferred = () => {
    const handlers: { resolve?: () => void; reject?: (e: Error) => void } = {};
    const promise = new Promise<void>((resolve, reject) => Object.assign(handlers, { resolve, reject }));
    return { promise, resolve: () => handlers.resolve?.(), reject: (e: Error) => handlers.reject?.(e) };
};

describe('createJobGate', () => {
    it('同時に走るのは concurrency 件まで。終わると待っていたものが走る', async () => {
        const gate = createJobGate({ concurrency: 2, maxWaiting: 5 });
        const started: number[] = [];
        const jobs = [deferred(), deferred(), deferred()];
        const runs = jobs.map((d, i) =>
            gate.run(async () => {
                started.push(i);
                await d.promise;
                return i;
            }),
        );
        await Promise.resolve();
        expect(started).toEqual([0, 1]);
        jobs[1].resolve();
        await expect(runs[1]).resolves.toBe(1);
        expect(started).toEqual([0, 1, 2]);
        jobs[0].resolve();
        jobs[2].resolve();
        await expect(Promise.all(runs)).resolves.toEqual([0, 1, 2]);
    });

    it('待ちが溢れたら待たせずに断る', async () => {
        const gate = createJobGate({ concurrency: 1, maxWaiting: 1 });
        const blocker = deferred();
        const first = gate.run(() => blocker.promise);
        const second = gate.run(async () => 'second');
        await expect(gate.run(async () => 'third')).rejects.toBeInstanceOf(JobGateFullError);
        blocker.resolve();
        await first;
        await expect(second).resolves.toBe('second');
    });

    it('失敗した処理も枠を返す（失敗が続いても詰まらない）', async () => {
        const gate = createJobGate({ concurrency: 1, maxWaiting: 0 });
        for (const _ of [1, 2, 3]) {
            await expect(gate.run(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
        }
        await expect(gate.run(async () => 'ok')).resolves.toBe('ok');
    });
});
