import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WORLD_ASSET_QUOTA, type WorldAsset } from '@ubichill/shared';
import express, { type RequestHandler } from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { WorldAssetOutcome } from '../../services/worldAssets/worldAssets';
import { createAssetsRouter } from './router';

const HASH = 'b'.repeat(43);

/** `x-user` でログインの扱い */
const requireAuth: RequestHandler = (req, res, next) => {
    const id = req.get('x-user');
    if (!id) return void res.status(401).json({ error: 'Unauthorized' });
    (req as unknown as { user: { id: string } }).user = { id };
    next();
};
const pass: RequestHandler = (_req, _res, next) => next();

const assets = {
    upload: vi.fn(
        async (_ownerId: string, input: Uint8Array): Promise<WorldAssetOutcome<WorldAsset>> =>
            input.byteLength > 0
                ? {
                      ok: true as const,
                      value: {
                          hash: HASH,
                          url: `https://ubi.example/api/v1/assets/${HASH}.webp`,
                          width: 1,
                          height: 1,
                          bytes: 3,
                          createdAt: '',
                      },
                  }
                : { ok: false as const, status: 400 as const, code: 'empty' as const, error: '画像が空です' },
    ),
    list: vi.fn(async () => ({ assets: [], usage: { count: 0, bytes: 0 }, quota: WORLD_ASSET_QUOTA })),
    remove: vi.fn(async (): Promise<WorldAssetOutcome<null>> => ({ ok: true, value: null })),
    image: vi.fn(async (hash: string) =>
        hash === HASH ? { hash, bytes: new Uint8Array([82, 73, 70, 70]), width: 1, height: 1 } : undefined,
    ),
};

const app = express();
app.use('/api/v1/assets', createAssetsRouter({ requireAuth, uploadLimiter: pass, assets }));
const server = createServer(app);
const url = (path: string) => `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/assets${path}`;

beforeAll(() => new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve)));
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

describe('assets router', () => {
    it('ログインしていれば画像を上げられ、201 で置いた画像を返す', async () => {
        const anonymous = await fetch(url('/'), {
            method: 'POST',
            headers: { 'content-type': 'image/png' },
            body: new Uint8Array([1]),
        });
        expect(anonymous.status).toBe(401);
        const res = await fetch(url('/'), {
            method: 'POST',
            headers: { 'content-type': 'image/png', 'x-user': 'alice' },
            body: new Uint8Array([1, 2, 3]),
        });
        expect(res.status).toBe(201);
        expect(await res.json()).toMatchObject({ hash: HASH });
        expect(assets.upload).toHaveBeenCalledWith('alice', new Uint8Array([1, 2, 3]));
    });

    it('画像でない本文は受け取らない', async () => {
        const res = await fetch(url('/'), {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-user': 'alice' },
            body: '{}',
        });
        expect(res.status).toBe(415);
    });

    it('配信は誰でも読め、長く cache させ、文書として何も実行させない', async () => {
        const res = await fetch(url(`/${HASH}.webp`));
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toBe('image/webp');
        expect(res.headers.get('cache-control')).toContain('immutable');
        expect(res.headers.get('content-security-policy')).toContain('sandbox');
        expect(res.headers.get('x-content-type-options')).toBe('nosniff');
        expect(res.headers.get('cross-origin-resource-policy')).toBe('cross-origin');
        expect(res.headers.get('access-control-allow-origin')).toBe('*');
        const missing = await fetch(url(`/${'c'.repeat(43)}.webp`));
        expect(missing.status).toBe(404);
        expect(missing.headers.get('cache-control')).toBe('no-store');
        expect((await fetch(url('/../../etc.webp'))).status).toBe(404);
    });

    it('消すと 204。形の違う名前は 404', async () => {
        expect((await fetch(url(`/${HASH}.webp`), { method: 'DELETE', headers: { 'x-user': 'alice' } })).status).toBe(
            204,
        );
        expect((await fetch(url('/nope.png'), { method: 'DELETE', headers: { 'x-user': 'alice' } })).status).toBe(404);
    });
});
