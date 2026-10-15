import { randomBytes } from 'node:crypto';
import type { RedisCommands } from '../lib/redis';

/**
 * 名前ごとに 1 人だけが持てる期限付きの権利（例: reaper を動かす backend を 1 台に絞る）。
 * token を持つ者だけが延長・解放できる。期限が切れたあとに古い token で延長・解放しても、次の持ち主の権利は奪えない。
 */
export interface Lease {
    /** 空いていれば取得して token を返す。持ち主がいれば null。 */
    acquire(name: string, ttlMs: number): Promise<string | null>;
    /** token が今の持ち主と一致するときだけ、期限を今から ttlMs に延ばす。 */
    renew(name: string, token: string, ttlMs: number): Promise<boolean>;
    /** token が今の持ち主と一致するときだけ解放する。 */
    release(name: string, token: string): Promise<boolean>;
}

function assertName(name: string): void {
    if (name === '') throw new RangeError('lease: name must be non-empty');
}

function assertTtl(ttlMs: number): void {
    if (!Number.isSafeInteger(ttlMs) || ttlMs < 1)
        throw new RangeError(`lease: ttlMs must be a positive integer (${ttlMs})`);
}

const newToken = (): string => randomBytes(16).toString('base64url');

/** 1 プロセスの中だけで有効なリース（Redis なしの単体・開発・テスト用）。 */
export function createMemoryLease(now: () => number = Date.now): Lease {
    const held = new Map<string, { token: string; expiresAt: number }>();
    // 期限切れはここで消す（Redis の期限切れと同じ見え方にする）
    const current = (name: string) => {
        const hold = held.get(name);
        if (hold && hold.expiresAt <= now()) {
            held.delete(name);
            return undefined;
        }
        return hold;
    };
    return {
        acquire: async (name, ttlMs) => {
            assertName(name);
            assertTtl(ttlMs);
            if (current(name)) return null;
            const token = newToken();
            held.set(name, { token, expiresAt: now() + ttlMs });
            return token;
        },
        renew: async (name, token, ttlMs) => {
            assertName(name);
            assertTtl(ttlMs);
            if (current(name)?.token !== token) return false;
            held.set(name, { token, expiresAt: now() + ttlMs });
            return true;
        },
        release: async (name, token) => {
            assertName(name);
            if (current(name)?.token !== token) return false;
            held.delete(name);
            return true;
        },
    };
}

// 値は token を 1 つの項目に持つハッシュ（Go の internal/coord と同じ形）。
// 照合と更新を 1 回の操作にしないと、GET と PEXPIRE の間に期限が切れて別の持ち主に移ったとき、その期限を延ばしてしまう。
const ACQUIRE = `if redis.call('EXISTS', KEYS[1]) == 1 then return 0 end
redis.call('HSET', KEYS[1], 'token', ARGV[1])
redis.call('PEXPIRE', KEYS[1], ARGV[2])
return 1`;
const RENEW = `if redis.call('HGET', KEYS[1], 'token') ~= ARGV[1] then return 0 end
return redis.call('PEXPIRE', KEYS[1], ARGV[2])`;
const RELEASE = `if redis.call('HGET', KEYS[1], 'token') ~= ARGV[1] then return 0 end
return redis.call('DEL', KEYS[1])`;

/** 複数の backend で共有するリース。keyPrefix はキーの名前空間（既定 `ubi:lease:`）。 */
export function createRedisLease(redis: RedisCommands, keyPrefix = 'ubi:lease:'): Lease {
    const run = async (script: string, name: string, args: string[]): Promise<boolean> =>
        (await redis.sendCommand(['EVAL', script, '1', keyPrefix + name, ...args])) === 1;
    return {
        acquire: async (name, ttlMs) => {
            assertName(name);
            assertTtl(ttlMs);
            const token = newToken();
            return (await run(ACQUIRE, name, [token, String(ttlMs)])) ? token : null;
        },
        renew: async (name, token, ttlMs) => {
            assertName(name);
            assertTtl(ttlMs);
            return run(RENEW, name, [token, String(ttlMs)]);
        },
        release: async (name, token) => {
            assertName(name);
            return run(RELEASE, name, [token]);
        },
    };
}
