import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import express, { type RequestHandler } from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FriendshipService } from '../../services/social/friends/friendships';
import { createFriendsRouter } from './friends';

const friendships = {
    list: vi.fn(async () => ({ friends: [], incoming: [], outgoing: [] })),
    request: vi.fn(async () => ({ ok: true as const, friendship: 'outgoing' as const })),
    accept: vi.fn(async () => ({ ok: true as const })),
    remove: vi.fn(async () => true),
} as unknown as FriendshipService;

const requireAuth: RequestHandler = (req, _res, next) => {
    Object.assign(req, { user: { id: 'alice' } });
    next();
};

const hits = { n: 0 };
const limiter: RequestHandler = (_req, res, next) => {
    hits.n += 1;
    if (hits.n > 2) return void res.status(429).json({ error: 'too many' });
    next();
};

const state: { base: string; close: () => void } = { base: '', close: () => undefined };

beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use(createFriendsRouter({ requireAuth, limiter, friendships }));
    const server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    state.base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    state.close = () => void server.close();
});
afterAll(() => state.close());
beforeEach(() => {
    hits.n = 0;
    vi.clearAllMocks();
});

const send = (method: string, path: string, body?: unknown) =>
    fetch(`${state.base}${path}`, {
        method,
        headers: { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
    });

describe('フレンドの申請の回数の制限', () => {
    it('申請（POST /friends）は limiter を通り、超えたら申請しない', async () => {
        const statuses = [];
        for (const userId of ['b', 'c', 'd']) statuses.push((await send('POST', '/friends', { userId })).status);
        expect(statuses).toEqual([200, 200, 429]);
        expect(friendships.request).toHaveBeenCalledTimes(2);
    });

    it('一覧は数えない', async () => {
        for (const _ of [1, 2, 3]) expect((await send('GET', '/friends')).status).toBe(200);
        expect(hits.n).toBe(0);
    });
});
