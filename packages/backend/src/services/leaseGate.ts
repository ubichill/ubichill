import { type OutageLog, redisOutage } from '../lib/redisOutage';
import type { Lease } from './lease';

/**
 * 定期処理を複数の backend のうち 1 台だけで動かすための関門。処理の前に {@link hold} を呼び、true のときだけ実行する。
 * 持っていれば延長し、持っていなければ取りに行く。Redis が落ちていれば false（消し過ぎない側に倒す）。
 */
export interface LeaseGate {
    hold(): Promise<boolean>;
    /** シャットダウンで手放す（次の backend がすぐ引き継げるように）。 */
    release(): Promise<void>;
}

export function createLeaseGate(lease: Lease, name: string, ttlMs: number, log: OutageLog): LeaseGate {
    const state: { token: string | null; pending: Promise<boolean> | null } = { token: null, pending: null };
    const outage = redisOutage(`定期の掃除（${name}）`, '止めます', log);

    const attempt = async (): Promise<boolean> => {
        try {
            if (state.token && (await lease.renew(name, state.token, ttlMs))) {
                outage.succeeded();
                return true;
            }
            const had = state.token !== null;
            state.token = await lease.acquire(name, ttlMs);
            outage.succeeded();
            if (had && !state.token) log.info(`リース ${name} をほかの backend に渡しました`);
            if (!had && state.token) log.info(`リース ${name} を取得しました（この backend が担当します）`);
            return state.token !== null;
        } catch (err) {
            // token は残す。期限内に戻れば延長でき、切れていれば次の延長が false を返す
            outage.failed(err);
            return false;
        }
    };

    return {
        // 同じ関門を複数のタイマーから呼んでも、取得の要求が重ならないようにまとめる
        hold: () => {
            if (!state.pending) {
                state.pending = attempt().finally(() => {
                    state.pending = null;
                });
            }
            return state.pending;
        },
        release: async () => {
            const token = state.token;
            state.token = null;
            if (!token) return;
            await lease.release(name, token).catch((err: unknown) => outage.failed(err));
        },
    };
}
