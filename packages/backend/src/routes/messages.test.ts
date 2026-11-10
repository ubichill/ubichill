import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { MESSAGE_LIMITS } from '@ubichill/shared';
import express, { type RequestHandler } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MessageService } from '../services/social/messages';
import { createMessagesRouter } from './messages';

const sent: Array<{ from: string; to: string; content: string }> = [];
const limiterHits = { n: 0 };

const service = {
    refusalBetween: async () => null,
    send: async (from: string, to: string, content: string) => {
        if (to !== 'bob')
            return { ok: false as const, reason: to === from ? ('self' as const) : ('not-friend' as const) };
        sent.push({ from, to, content });
        return {
            ok: true as const,
            message: { id: 'm1', senderId: from, content, published: '2026-11-10T00:00:00.000Z' },
        };
    },
    conversations: async () => [],
    conversation: async () => ({ ok: false as const, error: 'not-found' as const }),
    markRead: async () => 0,
} satisfies MessageService;

/** x-user ヘッダーの人としてログインしている。無ければ 401。 */
const requireAuth: RequestHandler = (req, res, next) => {
    const id = req.header('x-user');
    if (!id) return void res.status(401).json({ error: 'Unauthorized' });
    Object.assign(req, { user: { id } });
    next();
};

const limiter: RequestHandler = (_req, res, next) => {
    limiterHits.n += 1;
    if (limiterHits.n > 3) return void res.status(429).json({ error: 'too many' });
    next();
};

const state: { base: string; close: () => void } = { base: '', close: () => undefined };

beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use('/m', createMessagesRouter({ requireAuth, sendLimiters: [limiter], messages: service }));
    const server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    state.base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/m`;
    state.close = () => void server.close();
});
afterAll(() => state.close());

const post = (path: string, body: unknown, user: string | null = 'alice') =>
    fetch(`${state.base}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(user ? { 'x-user': user } : {}) },
        body: JSON.stringify(body),
    });

describe('POST /:userId', () => {
    it('ログインしていなければ、回数制限も数えずに断る', async () => {
        const res = await post('/bob', { content: 'x' }, null);
        expect(res.status).toBe(401);
        expect(limiterHits.n).toBe(0);
    });

    it('正規化した本文で送る（201）', async () => {
        const res = await post('/bob', { content: '  やあ\r\n ' });
        expect(res.status).toBe(201);
        expect(sent.at(-1)).toEqual({ from: 'alice', to: 'bob', content: 'やあ' });
    });

    it('長すぎる・空の本文は 400（送らない）', async () => {
        const before = sent.length;
        expect((await post('/bob', { content: 'a'.repeat(MESSAGE_LIMITS.CONTENT_MAX + 1) })).status).toBe(400);
        expect((await post('/bob', { content: '   ' })).status).toBe(400);
        expect(sent.length).toBe(before);
    });

    it('送れない相手は理由付きで 403、自分は 400', async () => {
        limiterHits.n = 0;
        const res = await post('/carol', { content: 'x' });
        expect(res.status).toBe(403);
        expect(await res.json()).toMatchObject({ reason: 'not-friend' });
        expect((await post('/alice', { content: 'x' })).status).toBe(400);
    });

    it('回数制限を超えると 429', async () => {
        limiterHits.n = 3;
        expect((await post('/bob', { content: 'x' })).status).toBe(429);
    });
});

describe('GET /:userId', () => {
    it('いない相手は 404', async () => {
        const res = await fetch(`${state.base}/ghost`, { headers: { 'x-user': 'alice' } });
        expect(res.status).toBe(404);
    });
});
