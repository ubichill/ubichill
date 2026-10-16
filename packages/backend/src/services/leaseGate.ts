import { type OutageLog, redisOutage } from '../lib/redisOutage';
import type { Lease } from './lease';

/**
 * 定期処理を複数の backend のうち 1 台だけで動かすための関門。処理の前に {@link hold} を呼び、true のときだけ実行する。
 * 持っていれば延長し、持っていなければ取りに行く。Redis が落ちていれば false（消し過ぎない側に倒す）。
 */
export interface LeaseGate {
    hold(): Promise<boolean>;
    /** 処理中も延長する。副作用の直前に checkpoint を呼び、false なら処理を止める。途中で取り直さない。 */
    run<T>(work: (checkpoint: () => Promise<boolean>) => Promise<T>): Promise<T | null>;
    /** シャットダウンで手放す（次の backend がすぐ引き継げるように）。 */
    release(): Promise<void>;
}

export function createLeaseGate(lease: Lease, name: string, ttlMs: number, log: OutageLog): LeaseGate {
    const state: { token: string | null; pending: Promise<boolean> | null; validUntil: number } = {
        token: null,
        pending: null,
        validUntil: 0,
    };
    const outage = redisOutage(`定期の掃除（${name}）`, '止めます', log);

    const safeMs = (ttlMs * 2) / 3;
    const attempt = async (): Promise<boolean> => {
        const sent = performance.now();
        try {
            if (state.token && (await lease.renew(name, state.token, ttlMs))) {
                state.validUntil = sent + safeMs;
                outage.succeeded();
                return performance.now() < state.validUntil;
            }
            const had = state.token !== null;
            state.token = await lease.acquire(name, ttlMs);
            outage.succeeded();
            if (had && !state.token) log.info(`リース ${name} をほかの backend に渡しました`);
            if (!had && state.token) log.info(`リース ${name} を取得しました（この backend が担当します）`);
            state.validUntil = sent + safeMs;
            return state.token !== null && performance.now() < state.validUntil;
        } catch (err) {
            // token は残す。期限内に戻れば延長でき、切れていれば次の延長が false を返す
            outage.failed(err);
            return false;
        }
    };

    const gate: LeaseGate = {
        // 同じ関門を複数のタイマーから呼んでも、取得の要求が重ならないようにまとめる
        hold: () => {
            if (!state.pending) {
                state.pending = attempt().finally(() => {
                    state.pending = null;
                });
            }
            return state.pending;
        },
        run: async (work) => {
            if (!(await gate.hold())) return null;
            const token = state.token;
            if (!token) return null;
            let deadline = state.validUntil;
            let stopped = false;
            let pending: Promise<boolean> | null = null;
            const current = () => !stopped && state.token === token && performance.now() < deadline;
            const checkpoint = (): Promise<boolean> => {
                if (!current()) {
                    stopped = true;
                    return Promise.resolve(false);
                }
                pending ??= (async () => {
                    const sent = performance.now();
                    let timeout: ReturnType<typeof setTimeout> | undefined;
                    try {
                        // 接続は生きていても応答が止まることがある。遅い延長で処理を生き返らせない。
                        const renewed = await Promise.race([
                            lease.renew(name, token, ttlMs),
                            new Promise<false>((resolve) => {
                                timeout = setTimeout(() => resolve(false), Math.min(ttlMs / 3, 2000));
                                timeout.unref?.();
                            }),
                        ]);
                        if (!renewed || !current()) {
                            stopped = true;
                            return false;
                        }
                        deadline = sent + safeMs;
                        outage.succeeded();
                        return current();
                    } catch (err) {
                        stopped = true;
                        outage.failed(err);
                        return false;
                    } finally {
                        clearTimeout(timeout);
                    }
                })().finally(() => {
                    pending = null;
                });
                return pending;
            };
            const timer = setInterval(
                () => {
                    void checkpoint();
                },
                Math.max(1, Math.floor(ttlMs / 3)),
            );
            timer.unref?.();
            try {
                return await work(checkpoint);
            } finally {
                stopped = true;
                clearInterval(timer);
            }
        },
        release: async () => {
            const token = state.token;
            state.token = null;
            if (!token) return;
            await lease.release(name, token).catch((err: unknown) => outage.failed(err));
        },
    };
    return gate;
}
