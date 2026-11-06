import type { RequestHandler } from 'express';
import type { RedisCommands } from './redis';
import { type OutageLog, redisOutage } from './redisOutage';

/** better-auth の `rateLimit.customStorage` の形（better-auth 1.7 の BetterAuthRateLimitStorage と同じ）。 */
export interface AuthRateLimitStorage {
    consume(
        key: string,
        rule: { window: number; max: number },
    ): Promise<{ allowed: boolean; retryAfter: number | null }>;
}

/** Redis が使えない間も通さないログインの口。総当たりは 1 回ごとにパスワードのハッシュ（CPU）も使わせる。 */
export const FAIL_CLOSED_AUTH_PATHS: ReadonlySet<string> = new Set(['/sign-in/email']);

// 窓の最初の 1 回で期限を付ける固定窓（better-auth の secondary-storage と同じ数え方）。
// 期限を失ったキー（PERSIST など）が永久に数え続けないよう、期限が無ければ付け直す。
const CONSUME = `local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return {n, ttl}`;

/** better-auth のキーは `<ip>|<path>`。IP に `|` は入らないので最初の `|` で分ける。 */
const pathOf = (key: string): string => key.slice(key.indexOf('|') + 1);

/**
 * better-auth のレート制限を複数の backend で合算する（`ubi:auth-rl:<ip>|<path>`）。
 * `secondaryStorage` を使わないのは、それを渡すとセッション・検証トークンの保存先まで Redis に移るため。
 * Redis が使えないときは fail-open（警告は 1 回）。ただし {@link FAIL_CLOSED_AUTH_PATHS} は通さない。
 */
export function createAuthRateLimitStorage(
    redis: RedisCommands,
    log: OutageLog,
    keyPrefix = 'ubi:auth-rl:',
): AuthRateLimitStorage {
    const outage = redisOutage(
        'better-auth のレート制限',
        `制限せずに通します（${[...FAIL_CLOSED_AUTH_PATHS].join(', ')} は止めます）`,
        log,
    );
    return {
        consume: async (key, rule) => {
            const windowMs = rule.window * 1000;
            try {
                const reply = await redis.sendCommand(['EVAL', CONSUME, '1', keyPrefix + key, String(windowMs)]);
                outage.succeeded();
                const [count, ttlMs] = (Array.isArray(reply) ? reply : []).map(Number) as [number, number];
                if (count <= rule.max) return { allowed: true, retryAfter: null };
                return { allowed: false, retryAfter: Math.max(1, Math.ceil(ttlMs / 1000)) };
            } catch (err) {
                outage.failed(err);
                if (FAIL_CLOSED_AUTH_PATHS.has(pathOf(key))) return { allowed: false, retryAfter: rule.window };
                return { allowed: true, retryAfter: null };
            }
        },
    };
}

/**
 * Redis を設定していて、いま繋がっていなければログインを 503 で断る（better-auth に入る前）。
 * better-auth の中で断ると 429（回数超過）にしか見せられないので、原因の分かる応答はここで返す。
 * レート制限が無効（開発など）なら止めない。
 */
export function requireSharedRateLimitForLogin(
    redis: { readonly isReady: boolean } | null | undefined,
    enabled: boolean,
): RequestHandler {
    return (_req, res, next) => {
        if (!enabled || !redis || redis.isReady) return next();
        res.set('Retry-After', '10');
        res.status(503).json({ error: 'ただいまログインを受け付けられません。しばらくしてから再試行してください。' });
    };
}
