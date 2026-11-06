import { describe, expect, it, vi } from 'vitest';
import { rateLimitContract, serveLimited } from './rateLimitContract';
import { createSharedRateLimitStore, sharedRateLimit } from './sharedRateLimit';

const quietLog = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });

describe('Redis なし（express-rate-limit のメモリの store）', () => {
    rateLimitContract(() => ({ options: () => sharedRateLimit('x', null, quietLog()), shared: false }));
});

/** 落ちたり戻ったりする Redis（rate-limit-redis が送る命令だけを、手で数えて返す）。 */
const flakyRedis = () => {
    const state = { down: false, scriptLoads: 0, counts: new Map<string, number>() };
    return {
        state,
        sendCommand: vi.fn(async (args: ReadonlyArray<string>): Promise<unknown> => {
            if (state.down) throw new Error('The client is closed');
            if (args[0] === 'SCRIPT') {
                state.scriptLoads += 1;
                return `sha-${state.scriptLoads}`;
            }
            if (args[0] === 'EVALSHA') {
                const key = args[3] as string;
                const next = (state.counts.get(key) ?? 0) + 1;
                state.counts.set(key, next);
                return [next, 60_000];
            }
            return 1;
        }),
    };
};

describe('sharedRateLimit（Redis が落ちたとき）', () => {
    it('Redis が落ちている間は制限せずに通し（fail-open）、警告は 1 回だけ。リクエストごとのエラーは出さない', async () => {
        const redis = flakyRedis();
        const log = quietLog();
        const backend = await serveLimited(sharedRateLimit('global', redis, log), 1);
        try {
            expect(await backend.hit()).toBe(200);
            expect(await backend.hit()).toBe(429);
            redis.state.down = true;
            expect([await backend.hit(), await backend.hit(), await backend.hit()]).toEqual([200, 200, 200]);
            expect(log.warn).toHaveBeenCalledTimes(1);
            expect(log.error).not.toHaveBeenCalled();
        } finally {
            await backend.close();
        }
    });

    it('起動時に Redis が落ちていても、戻ったら数え始める（失敗したスクリプトの読み込みを持ち続けない）', async () => {
        const redis = flakyRedis();
        redis.state.down = true;
        const log = quietLog();
        const backend = await serveLimited(sharedRateLimit('global', redis, log), 1);
        try {
            expect(await backend.hit()).toBe(200);
            redis.state.down = false;
            expect(await backend.hit()).toBe(200);
            expect(await backend.hit()).toBe(429);
            expect(log.info).toHaveBeenCalledWith(expect.stringContaining('Redis が戻りました'));
        } finally {
            await backend.close();
        }
    });

    it('キーは limiter ごとの名前空間に入る', async () => {
        const redis = flakyRedis();
        const store = createSharedRateLimitStore('instances-create', redis, quietLog());
        expect(store.prefix).toBe('ubi:rl:instances-create:');
        expect(store.localKeys).toBe(false);
    });
});
