import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    createPendingRegistration: vi.fn(async (_email: string, password: string) =>
        password === 'wrong-password'
            ? { success: false, error: 'この表示名は既に使用されています' }
            : { success: true, registrationId: 'reg' },
    ),
    verifyAndRegister: vi.fn(async () => ({ success: false, error: '認証コードが正しくありません' })),
    resendOTP: vi.fn(async () => ({ success: true })),
}));

vi.mock('../../services/users/userService', () => ({ userService: {} }));
vi.mock('../../config', () => ({ appConfig: { email: { skipVerification: false } } }));
vi.mock('../../lib/redis', () => ({ redis: null }));
vi.mock('../../lib/auth', () => ({
    createPendingRegistration: mocks.createPendingRegistration,
    verifyAndRegister: mocks.verifyAndRegister,
    resendOTP: mocks.resendOTP,
}));
vi.mock('../../middleware/auth', () => ({
    optionalAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock('../../services/users/displayName', () => ({ displayNameAvailability: vi.fn() }));

import { router } from './registration';

const app = express();
// 試験ごとに別の IP から来たことにする（IP ごとの数が試験の間で混ざらないように）
app.set('trust proxy', 'loopback');
app.use(express.json());
app.use('/api/v1/users', router);
const server = createServer(app);
const state = { base: '', ip: 0 };

beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    state.base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/users`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

beforeEach(() => {
    state.ip += 1;
    vi.clearAllMocks();
});
afterEach(() => vi.useRealTimers());

const post = async (path: string, body: unknown, ip = `10.0.0.${state.ip}`) => {
    const res = await fetch(`${state.base}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
        body: JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as { error?: string } };
};

const registration = (email: string, password = 'password123') => ({
    email,
    password,
    displayName: 'アリス',
    handle: 'alice',
});

describe('POST /resend-otp', () => {
    it('同じ登録への 60 秒以内の再送信は 429 で、メールは送らない', async () => {
        expect((await post('/resend-otp', { registrationId: 'reg-a' })).status).toBe(200);
        const second = await post('/resend-otp', { registrationId: 'reg-a' });
        expect(second.status).toBe(429);
        expect(second.body.error).toBeTruthy();
        expect(mocks.resendOTP).toHaveBeenCalledTimes(1);
    });

    it('別の IP から送り直しても、同じ登録への間隔は縮まない', async () => {
        expect((await post('/resend-otp', { registrationId: 'reg-b' }, '10.1.0.1')).status).toBe(200);
        expect((await post('/resend-otp', { registrationId: 'reg-b' }, '10.1.0.2')).status).toBe(429);
    });

    it('60 秒あければ送れるが、1 登録あたり 3 回まで。間隔で断った分は 3 回に数えない', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        const statuses: number[] = [];
        for (const _ of [1, 2, 3, 4]) {
            statuses.push((await post('/resend-otp', { registrationId: 'reg-c' })).status);
            statuses.push((await post('/resend-otp', { registrationId: 'reg-c' })).status);
            vi.setSystemTime(Date.now() + 61_000);
        }
        expect(statuses).toEqual([200, 429, 200, 429, 200, 429, 429, 429]);
        expect(mocks.resendOTP).toHaveBeenCalledTimes(3);
    });

    it('登録 ID の無い依頼が、ほかの人の再送信の枠を使い切らない', async () => {
        for (const _ of [1, 2, 3, 4, 5]) expect((await post('/resend-otp', {})).status).toBe(400);
        expect((await post('/resend-otp', { registrationId: 'reg-d' }, '10.2.0.1')).status).toBe(200);
    });

    it('1 つの IP から、でたらめな登録 ID を何度も送れない', async () => {
        const statuses: number[] = [];
        for (const n of Array.from({ length: 12 }, (_, i) => i)) {
            statuses.push((await post('/resend-otp', { registrationId: `guess-${n}` })).status);
        }
        expect(statuses.slice(0, 10).every((status) => status === 200)).toBe(true);
        expect(statuses.slice(10)).toEqual([429, 429]);
    });
});

describe('POST /register', () => {
    it('同じメールアドレスへは 1 時間に 3 通まで（大文字小文字・IP を変えても同じ）', async () => {
        const statuses = [];
        for (const [n, email] of [
            'bob@example.com',
            'BOB@example.com',
            'Bob@Example.com',
            'bob@EXAMPLE.com',
        ].entries()) {
            statuses.push((await post('/register', registration(email), `10.3.0.${n}`)).status);
        }
        expect(statuses).toEqual([200, 200, 200, 429]);
        expect(mocks.createPendingRegistration).toHaveBeenCalledTimes(3);
    });

    it('送らずに終わった申し込み（入力の誤り）は、メールアドレスの数に入れない', async () => {
        for (const _ of [1, 2, 3, 4, 5]) {
            expect((await post('/register', registration('carol@example.com', 'wrong-password'))).status).toBe(400);
        }
        expect((await post('/register', registration('carol@example.com'))).status).toBe(200);
    });

    it('1 つの IP からの申し込みは 15 分に 30 件まで（メールアドレスを変えても）', async () => {
        const statuses = await Promise.all(
            Array.from({ length: 31 }, (_, n) => post('/register', registration(`user${n}@example.com`))),
        );
        expect(statuses.filter((r) => r.status === 200)).toHaveLength(30);
        expect(statuses.filter((r) => r.status === 429)).toHaveLength(1);
    });
});

describe('POST /verify', () => {
    it('1 つの IP からの確認は 15 分に 60 回まで', async () => {
        const statuses: number[] = [];
        for (const n of Array.from({ length: 61 }, (_, i) => i)) {
            statuses.push((await post('/verify', { registrationId: `reg-${n}`, otp: '000000' })).status);
        }
        expect(statuses.slice(0, 60).every((status) => status === 400)).toBe(true);
        expect(statuses[60]).toBe(429);
        expect(mocks.verifyAndRegister).toHaveBeenCalledTimes(60);
    });
});
