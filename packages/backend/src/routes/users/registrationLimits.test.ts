import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/redis', () => ({ redis: null }));

import { PENDING_REGISTRATION_LIMITS } from '../../services/auth/pendingRegistrations';
import {
    createRegistrationLimiters,
    emailKeyOf,
    REGISTRATION_RATE_LIMITS,
    registrationKeyOf,
} from './registrationLimits';

describe('emailKeyOf', () => {
    it('大文字小文字の違いは同じメールアドレスとして数える', () => {
        expect(emailKeyOf({ email: 'Alice@Example.COM' })).toBe(emailKeyOf({ email: 'alice@example.com' }));
    });

    it('違うメールアドレスは別に数える', () => {
        expect(emailKeyOf({ email: 'alice@example.com' })).not.toBe(emailKeyOf({ email: 'alice2@example.com' }));
    });

    it('メールアドレスを平文のまま Redis のキーにしない', () => {
        const key = emailKeyOf({ email: 'alice@example.com' });
        expect(key).toBeDefined();
        expect(key).not.toContain('alice');
        expect(key).not.toContain('example');
    });

    it('巨大な入力でもキーの長さは一定', () => {
        expect(emailKeyOf({ email: `${'a'.repeat(100_000)}@example.com` })?.length).toBe(
            emailKeyOf({ email: 'a@example.com' })?.length,
        );
    });

    it.each([
        ['本文なし', undefined],
        ['null', null],
        ['配列', ['alice@example.com']],
        ['文字列', 'alice@example.com'],
        ['email なし', {}],
        ['空文字', { email: '' }],
        ['数値', { email: 1 }],
        ['オブジェクト', { email: { toString: () => 'alice@example.com' } }],
    ])('キーが取れない入力（%s）は undefined（共通のキーにまとめない）', (_label, body) => {
        expect(emailKeyOf(body)).toBeUndefined();
    });
});

describe('registrationKeyOf', () => {
    it('同じ登録 ID は同じキー、違う ID は別のキー', () => {
        expect(registrationKeyOf({ registrationId: 'abc' })).toBe(registrationKeyOf({ registrationId: 'abc' }));
        expect(registrationKeyOf({ registrationId: 'abc' })).not.toBe(registrationKeyOf({ registrationId: 'abd' }));
    });

    it('登録 ID（持っていれば確認できる値）を平文のまま Redis のキーにしない', () => {
        const id = 'Zm9vYmFyYmF6cXV4cXV1eHF1dXhxdXV4';
        expect(registrationKeyOf({ registrationId: id })).not.toContain(id);
    });

    it.each([
        ['本文なし', undefined],
        ['null', null],
        ['空文字', { registrationId: '' }],
        ['数値', { registrationId: 123 }],
        ['配列', { registrationId: ['abc'] }],
    ])('キーが取れない入力（%s）は undefined', (_label, body) => {
        expect(registrationKeyOf(body)).toBeUndefined();
    });
});

describe('REGISTRATION_RATE_LIMITS', () => {
    it('再送信は 60 秒に 1 回', () => {
        expect(REGISTRATION_RATE_LIMITS.resendInterval).toMatchObject({ windowMs: 60_000, limit: 1 });
    });

    it('1 登録あたりの再送信は 3 回。窓は、再送信で延ばせる仮登録の寿命より長い（窓が明けても同じ登録には送れない）', () => {
        const rule = REGISTRATION_RATE_LIMITS.resendPerRegistration;
        expect(rule.limit).toBe(3);
        // 最初の再送信から、再送信のたびに期限が ttl 延びる。最後の再送信の ttl 後には仮登録が消えている
        expect(rule.windowMs).toBeGreaterThan(rule.limit * PENDING_REGISTRATION_LIMITS.ttlMs);
    });

    it('同じメールアドレスへの登録は、同時に出せる仮登録の数を超えない', () => {
        expect(REGISTRATION_RATE_LIMITS.registerPerEmail.limit).toBeLessThanOrEqual(
            PENDING_REGISTRATION_LIMITS.maxPerEmail,
        );
    });
});

describe('createRegistrationLimiters', () => {
    const serve = async (disabled: boolean) => {
        const limiters = createRegistrationLimiters({ disabled });
        const app = express();
        app.use(express.json());
        app.post('/resend-otp', ...limiters.resendOtp, (_req, res) => {
            res.json({ ok: true });
        });
        const server = createServer(app);
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/resend-otp`;
        return {
            post: async (body: unknown) =>
                (
                    await fetch(url, {
                        method: 'POST',
                        headers: { 'content-type': 'application/json' },
                        body: JSON.stringify(body),
                    })
                ).status,
            close: () => new Promise<void>((resolve) => server.close(() => resolve())),
        };
    };

    it('メール確認をしない環境（SKIP_EMAIL_VERIFICATION）では制限しない（負荷試験・E2E が 1 つの IP から登録する）', async () => {
        const backend = await serve(true);
        try {
            const statuses = await Promise.all(
                Array.from({ length: 15 }, () => backend.post({ registrationId: 'same' })),
            );
            expect(statuses.every((status) => status === 200)).toBe(true);
        } finally {
            await backend.close();
        }
    });

    it('有効なら、同じ登録への 60 秒以内の再送信は 429', async () => {
        const backend = await serve(false);
        try {
            expect(await backend.post({ registrationId: 'r1' })).toBe(200);
            expect(await backend.post({ registrationId: 'r1' })).toBe(429);
            expect(await backend.post({ registrationId: 'r2' })).toBe(200);
        } finally {
            await backend.close();
        }
    });
});
