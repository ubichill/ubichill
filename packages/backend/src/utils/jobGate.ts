/** 同時に走らせる重い処理（画像の展開など）の数を抑える。待ちが溢れたら待たせずに断る。 */
export class JobGateFullError extends Error {}

export interface JobGate {
    run<T>(job: () => Promise<T>): Promise<T>;
}

export function createJobGate({ concurrency, maxWaiting }: { concurrency: number; maxWaiting: number }): JobGate {
    const state = { active: 0 };
    const waiting: Array<() => void> = [];
    const release = (): void => {
        const next = waiting.shift();
        if (next) next();
        else state.active -= 1;
    };
    // 空きが無ければ前の処理が終わるまで待つ（終わった処理は自分の枠をそのまま次に渡す）
    const acquire = (): Promise<void> => {
        if (state.active < concurrency) {
            state.active += 1;
            return Promise.resolve();
        }
        if (waiting.length >= maxWaiting) return Promise.reject(new JobGateFullError('混み合っています'));
        return new Promise<void>((resolve) => waiting.push(resolve));
    };
    return {
        async run(job) {
            await acquire();
            try {
                return await job();
            } finally {
                release();
            }
        },
    };
}
