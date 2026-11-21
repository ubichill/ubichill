import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { BotCheckOutcome } from '../services/auth/botProtection/botProtection';

vi.mock('../services/auth/botProtection/botProtectionService', () => ({ botProtectionService: {} }));

import { createBotCheck } from './botCheck';

const seen: Array<{ token: string | undefined; action: string; remoteIp: string | undefined }> = [];
const check = vi.fn(async (input: { token: string | undefined; action: string; remoteIp: string | undefined }) => {
    seen.push(input);
    if (input.token === 'throw') throw new Error('db down');
    const outcome: BotCheckOutcome =
        input.token === 'ok' ? { ok: true } : { ok: false, status: 400, code: 'bot-check-failed' };
    return outcome;
});

const app = express();
app.set('trust proxy', 'loopback');
app.post('/register', createBotCheck(check)('sign-up'), (_req, res) => {
    res.json({ registered: true });
});
const server = createServer(app);
const post = (headers: Record<string, string>) =>
    fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/register`, { method: 'POST', headers });

beforeAll(() => new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve)));
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

describe('createBotCheck', () => {
    it('ヘッダーのトークン・action・IP で確かめ、通れば次へ進む', async () => {
        const res = await post({ 'x-bot-check': 'ok', 'x-forwarded-for': '203.0.113.9' });
        expect(await res.json()).toEqual({ registered: true });
        expect(seen.at(-1)).toEqual({ token: 'ok', action: 'sign-up', remoteIp: '203.0.113.9' });
    });

    it('通らなければ次へ進まず、code・message・error を返す', async () => {
        const res = await post({ 'x-bot-check': 'bad' });
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({
            code: 'bot-check-failed',
            message: 'ボットでないことを確かめられませんでした。もう一度お試しください',
            error: 'ボットでないことを確かめられませんでした。もう一度お試しください',
        });
    });

    it('確かめる途中で失敗したら（設定を読めない）通さない', async () => {
        const res = await post({ 'x-bot-check': 'throw' });
        expect(res.status).toBe(503);
        expect(await res.json()).toMatchObject({ code: 'bot-check-unavailable' });
    });
});
