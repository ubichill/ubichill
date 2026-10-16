import type { Logger, Options, Store } from 'express-rate-limit';
import { type RedisReply, RedisStore } from 'rate-limit-redis';
import type { RedisCommands } from './redis';
import { type OutageLog, redisOutage } from './redisOutage';

/** 共有の数を数えられなかった（Redis が落ちている）。passOnStoreError で通し、警告は store が 1 回だけ出す。 */
export class SharedRateLimitUnavailable extends Error {}

const noop = (): void => {};

/**
 * 複数の backend で数を合算する express-rate-limit の store。キーは limiter ごとに分ける（`ubi:rl:<name>:`）。
 * 同じ prefix を共有すると、全体の limiter と各ルートの limiter が同じ IP の同じ数を足し合ってしまう。
 */
export function createSharedRateLimitStore(name: string, redis: RedisCommands, log: OutageLog): Store {
    const prefix = `ubi:rl:${name}:`;
    const inner = new RedisStore({
        prefix,
        sendCommand: (...args: string[]) => redis.sendCommand(args) as Promise<RedisReply>,
    });
    const outage = redisOutage(`HTTP のレート制限（${name}）`, '制限せずに通します', log);
    // rate-limit-redis は Lua の SHA を Promise のまま持ち続け、NOSCRIPT のときしか読み直さない。
    // Redis が落ちている間に読んだ失敗の Promise が残ると、戻っても数えられないままになるので、失敗のあとは読み直させる。
    const state = { stale: false };
    const reloadScripts = (): void => {
        const increment = inner.loadIncrementScript();
        const get = inner.loadGetScript();
        increment.catch(noop);
        get.catch(noop);
        inner.incrementScriptSha = increment;
        inner.getScriptSha = get;
    };
    const guarded = async <T>(run: () => Promise<T>): Promise<T> => {
        if (state.stale) {
            state.stale = false;
            reloadScripts();
        }
        try {
            const result = await run();
            outage.succeeded();
            return result;
        } catch (err) {
            state.stale = true;
            outage.failed(err);
            throw new SharedRateLimitUnavailable(err instanceof Error ? err.message : String(err));
        }
    };
    return {
        prefix,
        localKeys: false,
        init: (options) => {
            // 起動時に Redis が落ちていても、ここでは記録だけして最初の increment で読み直す
            return inner.init(options).catch((err: unknown) => {
                state.stale = true;
                outage.failed(err);
            });
        },
        get: (key) => guarded(() => inner.get(key)),
        increment: (key) => guarded(() => inner.increment(key)),
        decrement: (key) => guarded(() => inner.decrement(key)).catch(noop),
        resetKey: (key) => guarded(() => inner.resetKey(key)).catch(noop),
    };
}

/**
 * limiter に足す設定。Redis を設定していれば共有の store にし、落ちている間は制限せずに通す（fail-open）。
 * 設定していなければ何も足さない（express-rate-limit のメモリの store のまま）。
 */
export function sharedRateLimit(
    name: string,
    redis: RedisCommands | null | undefined,
    log: OutageLog & { error: (...args: unknown[]) => void },
): Partial<Options> {
    if (!redis) return {};
    // 通したリクエストごとに express-rate-limit が出すエラーは、store が 1 回だけ出す警告と重なるので捨てる
    const logger: Logger = {
        warn: (err, message) => log.warn(message ?? '', err),
        error: (err, message) => {
            if (err instanceof SharedRateLimitUnavailable) return;
            log.error(message ?? '', err);
        },
    };
    return { store: createSharedRateLimitStore(name, redis, log), passOnStoreError: true, logger };
}
