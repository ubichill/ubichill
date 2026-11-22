import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import express, { type RequestHandler } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RoomPortalGrants } from '../../services/instances/roomPortalGrant';
import { createRoomPortalsRouter } from './router';

const issued: Array<{ userId: string; room: string }> = [];
const grants: RoomPortalGrants = {
    issue: async (userId, room) => {
        if (room === 'boom') throw new Error('db down');
        if (room === 'secret' && userId !== 'aya') return { ok: false, status: 403, error: '作った人だけ' };
        issued.push({ userId, room });
        return { ok: true, grant: `grant-for-${userId}` };
    },
};

/** x-user ヘッダーの人としてログインしている。無ければ 401。 */
const requireAuth: RequestHandler = (req, res, next) => {
    const id = req.header('x-user');
    if (!id) return void res.status(401).json({ error: 'Unauthorized' });
    Object.assign(req, { user: { id } });
    next();
};

const state: { base: string; close: () => void } = { base: '', close: () => undefined };

beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use('/rp', createRoomPortalsRouter({ requireAuth, limiter: (_req, _res, next) => next(), grants }));
    const server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    state.base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/rp`;
    state.close = () => void server.close();
});

afterAll(() => state.close());

const post = (body: unknown, user?: string) =>
    fetch(`${state.base}/grants`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(user ? { 'x-user': user } : {}) },
        body: JSON.stringify(body),
    });

describe('POST /api/v1/room-portals/grants', () => {
    it('ログインした本人に、送った住所への許可を返す（キャッシュさせない）', async () => {
        const res = await post({ room: 'abc' }, 'bob');
        expect(res.status).toBe(200);
        expect(res.headers.get('cache-control')).toBe('no-store');
        expect(await res.json()).toEqual({ grant: 'grant-for-bob' });
        expect(issued.at(-1)).toEqual({ userId: 'bob', room: 'abc' });
    });

    it('ログインしていなければ 401、住所が無い・文字列でない・長すぎれば 400', async () => {
        expect((await post({ room: 'abc' })).status).toBe(401);
        for (const body of [{}, { room: 1 }, { room: '' }, { room: 'a'.repeat(321) }, null]) {
            expect((await post(body, 'bob')).status, JSON.stringify(body)).toBe(400);
        }
    });

    it('断られた理由はそのままの状態コードで返し、失敗は 500', async () => {
        const refused = await post({ room: 'secret' }, 'bob');
        expect(refused.status).toBe(403);
        expect(await refused.json()).toEqual({ error: '作った人だけ' });
        expect((await post({ room: 'boom' }, 'bob')).status).toBe(500);
    });
});
