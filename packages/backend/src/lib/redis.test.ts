import { setTimeout as sleep } from 'node:timers/promises';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../config', () => ({ appConfig: { redis: { url: undefined, password: undefined } } }));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn() } }));

import { connectRedis, redis, redisHealth } from './redis';

describe('redis', () => {
    it('REDIS_URL が無ければ接続を作らず、/health にも載せない', () => {
        expect(redis).toBeNull();
        expect(redisHealth(null)).toBeUndefined();
    });

    it('接続の状態をそのまま /health の値にする', () => {
        expect(redisHealth({ isReady: true })).toBe('ready');
        expect(redisHealth({ isReady: false })).toBe('unavailable');
    });

    it('繋がらない Redis でも起動を止めず、命令は待たずに失敗し、警告は 1 回だけ出す', async () => {
        const log = { warn: vi.fn(), info: vi.fn() };
        // 127.0.0.1:1 は接続を拒否される（再接続が何度も起きる）
        const client = connectRedis({ url: 'redis://127.0.0.1:1' }, log);
        try {
            await sleep(400);
            expect(redisHealth(client)).toBe('unavailable');
            const started = Date.now();
            await expect(client.sendCommand(['PING'])).rejects.toThrow();
            expect(Date.now() - started).toBeLessThan(100);
            expect(log.warn).toHaveBeenCalledTimes(1);
            expect(log.info).not.toHaveBeenCalled();
        } finally {
            client.destroy();
        }
    });
});
