import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { MAX_EXTERNAL_WORKS_PER_USER } from '@ubichill/shared';
import express, { type NextFunction, type Request, type Response } from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/** 外部への取得・署名の検証を起こす書き込みの口に、利用者ごとの回数の制限が付いているか（limiter はメモリの store）。 */
const mocks = vi.hoisted(() => ({
    saveBundle: vi.fn(async () => ({ ok: true, world: { id: 'w', url: 'https://x.test/w.yaml' }, saved: 'unsigned' })),
    addFavorite: vi.fn(async () => ({ ok: true, worldRef: 'https://x.test/w.yaml' })),
    addModFavorite: vi.fn(async () => ({ ok: true, mod: { author: 'a@x.test', id: 'pen' } })),
    registerExternalWork: vi.fn(async () => ({ ok: true, work: {} })),
    /** x-user ヘッダーの人としてログインしている。 */
    signedIn: (req: Request, res: Response, next: NextFunction) => {
        const id = req.header('x-user');
        if (!id) return void res.status(401).json({ error: 'Unauthorized' });
        Object.assign(req, { user: { id } });
        next();
    },
}));

vi.mock('../services/users/userService', () => ({
    userService: { byId: vi.fn(async (id: string) => ({ id, handle: id })) },
}));
vi.mock('../services/authors/publishingEnvironmentService', () => ({ publishingEnvironmentService: {} }));
vi.mock('../lib/redis', () => ({ redis: null }));
vi.mock('../middleware/auth', () => ({
    optionalAuth: mocks.signedIn,
    requireAuth: mocks.signedIn,
    requireAdmin: mocks.signedIn,
    requirePublisher: mocks.signedIn,
}));
vi.mock('../services/auth/cliAuth', () => ({ bearerToken: () => undefined }));
vi.mock('../services/authors/authorKeys', () => ({ selfAccount: (handle: string) => `${handle}@x.test` }));
vi.mock('../services/federation', () => ({ federation: null }));
vi.mock('../services/worlds/worldRegistry', () => ({ worldRegistry: { saveBundle: mocks.saveBundle } }));
vi.mock('../services/worlds/favoriteService', () => ({ favoriteService: { add: mocks.addFavorite } }));
vi.mock('../services/mods/modFavoriteService', () => ({ modFavoriteService: { add: mocks.addModFavorite } }));
vi.mock('../services/worlds/externalWorkRegistration', () => ({
    registerExternalWork: mocks.registerExternalWork,
    removeExternalWork: vi.fn(),
}));
vi.mock('../services/worlds/externalWorkService', () => ({ externalWorkStatuses: vi.fn() }));
vi.mock('../services/worlds/myWorlds', () => ({ myWorldsOf: vi.fn() }));

import { router as favorites } from './users/favorites';
import { router as works } from './users/works';
import { router as worlds } from './worlds';

const app = express();
app.use(express.json());
app.use('/api/v1/worlds', worlds);
app.use('/api/v1/users', favorites, works);
const server = createServer(app);
const state = { base: '' };

beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    state.base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

const send = async (method: string, path: string, user: string, body: unknown) =>
    (
        await fetch(`${state.base}${path}`, {
            method,
            headers: { 'content-type': 'application/json', 'x-user': user },
            body: JSON.stringify(body),
        })
    ).status;

/** n 回送った状態コード。 */
const repeat = async (n: number, run: () => Promise<number>) => {
    const statuses: number[] = [];
    for (const _ of Array.from({ length: n })) statuses.push(await run());
    return statuses;
};

describe('書き込みの口の、利用者ごとの回数の制限', () => {
    it('ワールドの保存（PUT /worlds）は 1 分に 30 回まで。ほかの人の数とは別', async () => {
        const save = (user: string) => send('PUT', '/api/v1/worlds', user, { yaml: 'metadata: {}\n' });
        const statuses = await repeat(31, () => save('alice'));
        expect(statuses.slice(0, 30).every((s) => s === 200)).toBe(true);
        expect(statuses[30]).toBe(429);
        expect(mocks.saveBundle).toHaveBeenCalledTimes(30);
        expect(await save('bob')).toBe(200);
    });

    it('お気に入りの追加は 1 分に 30 回まで', async () => {
        const statuses = await repeat(31, () =>
            send('POST', '/api/v1/users/me/favorites', 'carol', { worldRef: 'https://x.test/w.yaml' }),
        );
        expect(statuses.slice(0, 30).every((s) => s === 201)).toBe(true);
        expect(statuses[30]).toBe(429);
        expect(mocks.addFavorite).toHaveBeenCalledTimes(30);
    });

    it('お気に入りの mod の追加（作者のカタログを引く）も 1 分に 30 回まで。ワールドのお気に入りとは別に数える', async () => {
        const add = (user: string) =>
            send('POST', '/api/v1/users/me/favorites/mods', user, { author: 'a@x.test', id: 'pen' });
        const statuses = await repeat(31, () => add('erin'));
        expect(statuses.slice(0, 30).every((s) => s === 201)).toBe(true);
        expect(statuses[30]).toBe(429);
        expect(mocks.addModFavorite).toHaveBeenCalledTimes(30);
        expect(await send('POST', '/api/v1/users/me/favorites', 'erin', { worldRef: 'https://x.test/w.yaml' })).toBe(
            201,
        );
    });

    it('外部の作品の登録は、上限の数（全部を 1 回で登録し直す CI）までは通し、それを超えたら 429', async () => {
        const register = () =>
            send('PUT', '/api/v1/users/me/external-works', 'dave', {
                kind: 'world',
                url: 'https://x.test/w.yaml',
                yaml: 'metadata: {}\n',
                signature: null,
            });
        const statuses = await Promise.all(Array.from({ length: MAX_EXTERNAL_WORKS_PER_USER + 1 }, register));
        expect(statuses.filter((s) => s === 200)).toHaveLength(MAX_EXTERNAL_WORKS_PER_USER);
        expect(statuses.filter((s) => s === 429)).toHaveLength(1);
    });
});
