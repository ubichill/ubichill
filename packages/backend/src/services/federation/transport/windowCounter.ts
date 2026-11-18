/**
 * 窓ごとの回数を数える（express-rate-limit の store。Redis の store なら backend 全体で合算する）。
 * limiter と違い、数えるかどうかを結果を見てから決められる（署名が通らなかった要求だけを数える、など）。
 * 数えられないとき（Redis が落ちている）は通す（ほかの limiter と同じ fail-open）。
 */
import type { Options, Store } from 'express-rate-limit';

export interface WindowCounter {
    /** key の数が上限に達しているか（数えない） */
    exceeded(key: string): Promise<boolean>;
    /** key を 1 つ数え、上限の内側なら true */
    take(key: string): Promise<boolean>;
}

export function createWindowCounter(store: Store, rule: { limit: number; windowMs: number }): WindowCounter {
    // limiter の外で使うので、limiter の代わりに窓の長さを渡す（MemoryStore・rate-limit-redis が init で読むのは windowMs だけ）
    const ready = Promise.resolve()
        .then(() => store.init?.({ windowMs: rule.windowMs } as Options))
        .catch(() => undefined);
    return {
        async exceeded(key) {
            await ready;
            const info = await Promise.resolve()
                .then(() => store.get?.(key))
                .catch(() => undefined);
            return !!info && info.totalHits >= rule.limit;
        },
        async take(key) {
            await ready;
            const info = await Promise.resolve()
                .then(() => store.increment(key))
                .catch(() => undefined);
            return !info || info.totalHits <= rule.limit;
        },
    };
}
