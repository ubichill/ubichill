import type { RedisCommands } from '../lib/redis';

/**
 * 「Go に部屋が無い」と最初に観測した時刻（reaper の復旧猶予の起点）。
 * 共有すると、reaper のリースが別の backend に移っても猶予が延びたり縮んだりしない。
 */
export interface AbsenceClock {
    /** 各 id の起点を返す。記録が無ければ now を起点として記録する（2 回目からは最初の時刻のまま）。 */
    since(ids: readonly string[], now: number): Promise<ReadonlyMap<string, number>>;
    /** 起点を消す（部屋が見つかった・インスタンスを消した）。次に不在を観測したら数え直す。 */
    forget(ids: readonly string[]): Promise<void>;
}

function assertTtl(ttlMs: number): void {
    if (!Number.isSafeInteger(ttlMs) || ttlMs < 1)
        throw new RangeError(`absenceClock: ttlMs must be a positive integer (${ttlMs})`);
}

/**
 * 1 プロセスの中だけの記録（Redis なし）。ttlMs は消し忘れ（reaper 以外で消えたインスタンス）の掃除のためで、
 * 過ぎると数え直しになる（消し過ぎない側）。
 */
export function createMemoryAbsenceClock(ttlMs: number, clock: () => number = Date.now): AbsenceClock {
    assertTtl(ttlMs);
    const records = new Map<string, { since: number; expiresAt: number }>();
    return {
        since: async (ids, now) => {
            const t = clock();
            for (const [id, record] of records) if (record.expiresAt <= t) records.delete(id);
            for (const id of ids) if (!records.has(id)) records.set(id, { since: now, expiresAt: t + ttlMs });
            return new Map(ids.map((id) => [id, records.get(id)?.since ?? now]));
        },
        forget: async (ids) => {
            for (const id of ids) records.delete(id);
        },
    };
}

// 最初の時刻だけを残す（SET NX）。複数の id を 1 往復で済ませる
const SINCE = `local out = {}
for i, key in ipairs(KEYS) do
  redis.call('SET', key, ARGV[1], 'NX', 'PX', ARGV[2])
  out[i] = redis.call('GET', key)
end
return out`;

/** 複数の backend で共有する記録（`ubi:absent:<instanceId>`）。 */
export function createRedisAbsenceClock(redis: RedisCommands, ttlMs: number, keyPrefix = 'ubi:absent:'): AbsenceClock {
    assertTtl(ttlMs);
    return {
        since: async (ids, now) => {
            if (ids.length === 0) return new Map();
            const keys = ids.map((id) => keyPrefix + id);
            const reply = await redis.sendCommand([
                'EVAL',
                SINCE,
                String(keys.length),
                ...keys,
                String(now),
                String(ttlMs),
            ]);
            const values = Array.isArray(reply) ? reply : [];
            return new Map(
                ids.map((id, i) => {
                    const stored = Number(values[i]);
                    return [id, Number.isFinite(stored) ? stored : now];
                }),
            );
        },
        forget: async (ids) => {
            if (ids.length === 0) return;
            await redis.sendCommand(['DEL', ...ids.map((id) => keyPrefix + id)]);
        },
    };
}

/** Redis を設定していれば Redis の記録だけを使う（落ちてもメモリへ切り替えない。reaper はリースを取れず止まる）。 */
export function absenceClockFor(redis: RedisCommands | undefined, ttlMs: number): AbsenceClock {
    return redis ? createRedisAbsenceClock(redis, ttlMs) : createMemoryAbsenceClock(ttlMs);
}
