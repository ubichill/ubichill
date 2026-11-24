import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { DEFAULT_SERVER_BRANDING, DEFAULT_SERVER_INFO } from '@ubichill/shared';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServerRouter } from './router';

const HASH = 'h'.repeat(43);
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47]);
const asked: Array<[string, string]> = [];
const directoryOn = { value: true };

const app = express();
app.use(
    '/api/v1/server',
    createServerRouter({
        overview: async () => ({
            info: DEFAULT_SERVER_INFO,
            branding: DEFAULT_SERVER_BRANDING,
            registrationOpen: true,
            stats: { users: 3 },
        }),
        image: async (variant, hash) => {
            asked.push([variant, hash]);
            return variant === 'favicon' && hash === HASH ? { hash, bytes: PNG } : undefined;
        },
        directory: async () => (directoryOn.value ? ['aya', 'bob'] : null),
        directoryLimiter: (_req, _res, next) => next(),
    }),
);
const server = createServer(app);
const get = (path: string) => fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/server${path}`);

describe('サーバーの情報の API（ログインしなくても読める）', () => {
    beforeAll(async () => {
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    });
    afterAll(async () => {
        await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    it('情報とブランディングは、変えたらすぐ出るよう毎回確かめさせる', async () => {
        const overview = await get('/');
        expect(overview.headers.get('cache-control')).toBe('no-cache');
        expect(await overview.json()).toMatchObject({ branding: DEFAULT_SERVER_BRANDING, stats: { users: 3 } });
    });

    it('画像は種類に合った形式で長く cache させ、文書として実行させない', async () => {
        const res = await get(`/images/favicon/${HASH}.png`);
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toBe('image/png');
        expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
        expect(res.headers.get('x-content-type-options')).toBe('nosniff');
        expect(res.headers.get('content-security-policy')).toContain('sandbox');
        expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG);
    });

    it('知らない種類・拡張子の違い・形の違うハッシュは、DB を引かずに 404（cache させない）', async () => {
        asked.length = 0;
        for (const path of [
            `/images/avatar/${HASH}.png`,
            `/images/__proto__/${HASH}.png`,
            `/images/favicon/${HASH}.webp`,
            `/images/banner/${HASH}.png`,
            '/images/favicon/short.png',
        ]) {
            const res = await get(path);
            expect(res.status, path).toBe(404);
            expect(res.headers.get('cache-control'), path).toBe('no-store');
        }
        expect(asked).toEqual([]);
        // 形は合っているが今の画像でない
        expect((await get(`/images/icon-512/${HASH}.png`)).status).toBe(404);
        expect(asked).toEqual([['icon-512', HASH]]);
    });

    it('検索に出してよい人は ID だけを返す（アカウントを変えた時刻は出さない）', async () => {
        directoryOn.value = true;
        const res = await get('/directory');
        expect(res.headers.get('cache-control')).toBe('public, max-age=600');
        expect(await res.json()).toEqual({ users: [{ handle: 'aya' }, { handle: 'bob' }] });
    });

    it('本番でなければ 404（cache させない）', async () => {
        directoryOn.value = false;
        const res = await get('/directory');
        expect(res.status).toBe(404);
        expect(res.headers.get('cache-control')).toBe('no-store');
    });
});
