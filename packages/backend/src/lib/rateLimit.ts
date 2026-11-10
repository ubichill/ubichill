import type { RequestHandler } from 'express';
import rateLimit, { type Options } from 'express-rate-limit';
import { logger } from '../utils/logger';
import { redis } from './redis';
import { sharedRateLimit } from './sharedRateLimit';

/**
 * ログインしている人ごとの回数の制限（Redis があれば複数の backend で合算する）。`name` は Redis のキーを limiter ごとに
 * 分ける名前（同じ名前を使い回すと数が足し合わされる）。`options.skip` で数える対象を絞れる。
 */
export function perUserLimiter(
    name: string,
    windowMs: number,
    limit: number,
    error: string,
    options: Pick<Partial<Options>, 'skip'> = {},
): RequestHandler {
    return rateLimit({
        windowMs,
        limit,
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: (req) => req.user?.id ?? 'anonymous',
        message: { error },
        ...options,
        ...sharedRateLimit(name, redis, logger),
    });
}
