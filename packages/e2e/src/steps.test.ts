import { describe, expect, it, vi } from 'vitest';
import { firstFailure, formatResult, runSteps, type Step } from './steps.ts';

const clock = () => {
    const t = { now: 0 };
    return () => {
        t.now += 10;
        return t.now;
    };
};

describe('runSteps', () => {
    it('文脈を次の段へ渡す', async () => {
        const steps: Step<number>[] = [
            { name: '足す', run: async (n) => n + 1 },
            { name: '倍', run: async (n) => n * 2 },
        ];
        const outcome = await runSteps(steps, 1, { now: clock() });
        expect(outcome.context).toBe(4);
        expect(outcome.passed).toBe(true);
        expect(outcome.results.map((r) => r.status)).toEqual(['passed', 'passed']);
    });

    it('落ちたら以降は飛ばすが、後片付け（always）は落ちる前の文脈で走らせる', async () => {
        const cleanup = vi.fn(async (n: number) => n);
        const later = vi.fn(async (n: number) => n);
        const steps: Step<number>[] = [
            { name: '作る', run: async () => 7 },
            {
                name: '壊れる',
                run: async () => {
                    throw new Error('届きませんでした');
                },
            },
            { name: '次', run: later },
            { name: '後片付け', run: cleanup, always: true },
        ];
        const outcome = await runSteps(steps, 0, { now: clock() });
        expect(outcome.passed).toBe(false);
        expect(later).not.toHaveBeenCalled();
        expect(cleanup).toHaveBeenCalledWith(7);
        expect(outcome.results.map((r) => [r.name, r.status])).toEqual([
            ['作る', 'passed'],
            ['壊れる', 'failed'],
            ['次', 'skipped'],
            ['後片付け', 'passed'],
        ]);
        expect(firstFailure(outcome.results)).toMatchObject({ name: '壊れる', error: '届きませんでした' });
    });

    it('後片付けだけが落ちても全体は失敗', async () => {
        const steps: Step<number>[] = [
            { name: '通る', run: async (n) => n },
            {
                name: '後片付け',
                always: true,
                run: async () => {
                    throw new Error('消せません');
                },
            },
        ];
        const outcome = await runSteps(steps, 0, { now: clock() });
        expect(outcome.passed).toBe(false);
        expect(firstFailure(outcome.results)?.name).toBe('後片付け');
    });

    it('終わらない段は期限で落とし、次の段へ進まない', async () => {
        const steps: Step<number>[] = [
            { name: '止まる', run: () => new Promise<number>(() => {}), timeoutMs: 20 },
            { name: '次', run: async (n) => n },
        ];
        const outcome = await runSteps(steps, 0);
        expect(outcome.results[0]).toMatchObject({ status: 'failed', error: expect.stringContaining('20ms') });
        expect(outcome.results[1]?.status).toBe('skipped');
    });

    it('Error 以外を投げても理由を文字列で残す', async () => {
        const steps: Step<number>[] = [
            {
                name: '文字列',
                run: () => Promise.reject('bad'),
            },
        ];
        const outcome = await runSteps(steps, 0);
        expect(outcome.results[0]?.error).toBe('bad');
    });

    it('段ごとに結果を知らせる（飛ばした段も）', async () => {
        const seen: string[] = [];
        const steps: Step<number>[] = [
            { name: 'a', run: () => Promise.reject(new Error('x')) },
            { name: 'b', run: async (n) => n },
        ];
        await runSteps(steps, 0, { onResult: (r) => seen.push(`${r.name}:${r.status}`) });
        expect(seen).toEqual(['a:failed', 'b:skipped']);
    });
});

describe('formatResult', () => {
    it('失敗は理由を複数行でも字下げして出す', () => {
        expect(formatResult({ name: 'x', status: 'failed', ms: 5, error: '1行目\n2行目' })).toBe(
            '  FAIL  x (5ms)\n       1行目\n       2行目',
        );
    });

    it('飛ばした段は時間を出さない', () => {
        expect(formatResult({ name: 'y', status: 'skipped', ms: 0 })).toBe('  SKIP  y');
    });
});
