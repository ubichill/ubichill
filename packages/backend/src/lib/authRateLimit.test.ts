import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { betterAuth } from 'better-auth';
import express from 'express';
import { describe, expect, it, vi } from 'vitest';
import { type AuthRateLimitStorage, createAuthRateLimitStorage, requireSharedRateLimitForLogin } from './authRateLimit';

const quietLog = () => ({ info: vi.fn(), warn: vi.fn() });
const down = { sendCommand: async (): Promise<unknown> => Promise.reject(new Error('The client is closed')) };

describe('createAuthRateLimitStorage（Redis が落ちたとき）', () => {
    it('ログインは通さず、ほかの口は通す。警告は 1 回だけ', async () => {
        const log = quietLog();
        const storage = createAuthRateLimitStorage(down, log);
        const rule = { window: 10, max: 3 };
        expect(await storage.consume('1.2.3.4|/sign-in/email', rule)).toEqual({ allowed: false, retryAfter: 10 });
        expect(await storage.consume('1.2.3.4|/get-session', rule)).toEqual({ allowed: true, retryAfter: null });
        expect(await storage.consume('::1|/sign-out', rule)).toEqual({ allowed: true, retryAfter: null });
        expect(log.warn).toHaveBeenCalledTimes(1);
    });

    it('IPv6 の IP でも口を取り違えない', async () => {
        const storage = createAuthRateLimitStorage(down, quietLog());
        expect(await storage.consume('2001:db8::1|/sign-in/email', { window: 10, max: 3 })).toEqual({
            allowed: false,
            retryAfter: 10,
        });
    });
});

describe('requireSharedRateLimitForLogin', () => {
    const serve = async (redis: { isReady: boolean } | null, enabled: boolean) => {
        const app = express();
        app.use('/api/auth/sign-in/email', requireSharedRateLimitForLogin(redis, enabled));
        app.use((_req, res) => {
            res.send('passed');
        });
        const server = createServer(app);
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        return {
            post: async (path: string) => (await fetch(base + path, { method: 'POST' })).status,
            close: () => new Promise<void>((resolve) => server.close(() => resolve())),
        };
    };

    it('Redis を設定していて繋がっていなければ、ログインだけ 503', async () => {
        const backend = await serve({ isReady: false }, true);
        try {
            expect(await backend.post('/api/auth/sign-in/email')).toBe(503);
            expect(await backend.post('/api/auth/sign-in/email/')).toBe(503);
            expect(await backend.post('/api/auth/sign-out')).toBe(200);
        } finally {
            await backend.close();
        }
    });

    it('繋がっている・Redis なし・レート制限が無効なら止めない', async () => {
        for (const [redis, enabled] of [
            [{ isReady: true }, true],
            [null, true],
            [{ isReady: false }, false],
        ] as const) {
            const backend = await serve(redis, enabled);
            try {
                expect(await backend.post('/api/auth/sign-in/email')).toBe(200);
            } finally {
                await backend.close();
            }
        }
    });
});

describe('better-auth の customStorage の口（better-auth の版が変わったら気付けるように）', () => {
    it('ログインの判定に `<ip>|/sign-in/email` のキーと既定の規則で問い合わせ、断れば 429', async () => {
        const consume = vi.fn<AuthRateLimitStorage['consume']>(async () => ({ allowed: false, retryAfter: 7 }));
        const auth = betterAuth({
            secret: 'test-secret-test-secret-test-secret-0000',
            baseURL: 'http://localhost:3001',
            emailAndPassword: { enabled: true },
            advanced: { ipAddress: { ipAddressHeaders: ['x-forwarded-for'] } },
            rateLimit: { enabled: true, window: 60, max: 100, customStorage: { consume } },
            logger: { disabled: true },
            telemetry: { enabled: false },
        });
        const res = await auth.handler(
            new Request('http://localhost:3001/api/auth/sign-in/email', {
                method: 'POST',
                headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9' },
                body: JSON.stringify({ email: 'a@example.com', password: 'x' }),
            }),
        );
        expect(res.status).toBe(429);
        expect(consume).toHaveBeenCalledWith('203.0.113.9|/sign-in/email', { window: 10, max: 3 });
    });
});
