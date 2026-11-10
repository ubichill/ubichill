import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { PROFILE_IMAGE_MAX_BYTES, type StoredProfileFields, type UserProfile } from '@ubichill/shared';
import express, { type RequestHandler } from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImageCodec } from '../../services/profiles/images/imageCodec';
import type { ImageStore, StoredImage } from '../../services/profiles/images/imageStore';
import { processProfileImage } from '../../services/profiles/images/processImage';
import { createProfileService, type ProfileUserStore } from '../../services/profiles/profiles';
import { createJobGate } from '../../utils/jobGate';
import { createProfilesRouter } from './router';

const BASE = 'https://ubichill.example';

/** 偽の users（メモリ）。 */
function memoryUsers(): ProfileUserStore & { rows: Map<string, StoredProfileFields> } {
    const rows = new Map<string, StoredProfileFields>();
    const update = (id: string, patch: Partial<StoredProfileFields>) => {
        const row = rows.get(id);
        if (!row) return undefined;
        const next = { ...row, ...patch };
        rows.set(id, next);
        return next;
    };
    return {
        rows,
        findById: async (id) => rows.get(id),
        setProfile: async (id, profile) => update(id, profile),
        setProfileImageUrl: async (id, kind, url) =>
            update(id, kind === 'avatar' ? { image: url } : { bannerImage: url }),
    };
}

/** 偽の置き場所（利用者・種類ごとに 1 枚）。 */
function memoryImages(): ImageStore & { blobs: Map<string, StoredImage> } {
    const blobs = new Map<string, StoredImage>();
    return {
        blobs,
        put: async (userId, kind, image) => void blobs.set(`${userId}/${kind}`, image),
        get: async (userId, kind, hash) => {
            const blob = blobs.get(`${userId}/${kind}`);
            return blob?.hash === hash ? blob : undefined;
        },
        remove: async (userId, kind) => blobs.delete(`${userId}/${kind}`),
    };
}

/** 偽の画像処理。先頭のバイトを「形式」、中身をそのまま出力として扱う（sharp は processImage.test.ts で確かめる）。 */
const fakeCodec: ImageCodec = {
    probe: async (input) => {
        const format = { 1: 'png', 2: 'svg', 3: 'jpeg' }[input[0]];
        return format ? { format, width: 100, height: 100 } : null;
    },
    render: async (input, size) => ({ bytes: Uint8Array.from(input), ...size }),
};

const users = memoryUsers();
const images = memoryImages();
const processImage = vi.fn((input: Uint8Array, kind: 'avatar' | 'banner') =>
    gate.run(() => processProfileImage(input, kind, fakeCodec)),
);
const gate = createJobGate({ concurrency: 1, maxWaiting: 0 });

/** `x-user` ヘッダの利用者でログインしている扱い（無ければ 401）。 */
const requireAuth: RequestHandler = (req, res, next) => {
    const id = req.get('x-user');
    if (!id) return void res.status(401).json({ error: 'Unauthorized' });
    req.user = { id, email: `${id}@example.com`, name: id, emailVerified: true };
    next();
};
const limited = { count: 0, max: Number.POSITIVE_INFINITY };
const uploadLimiter: RequestHandler = (_req, res, next) => {
    limited.count += 1;
    if (limited.count > limited.max) return void res.status(429).json({ error: 'too many' });
    next();
};

const app = express();
app.use(express.json());
app.use(
    '/api/v1/users',
    createProfilesRouter({
        requireAuth,
        writeLimiter: (_req, _res, next) => next(),
        uploadLimiter,
        profiles: createProfileService({
            users,
            images,
            processImage,
            publicBaseUrl: `${BASE}/`,
            authorOf: (handle) => `${handle}@ubichill.example`,
            publicRolesOf: async (userId) =>
                userId === 'u1' ? [{ id: 'r1', name: 'スタッフ', color: '#ff8800' }] : [],
        }),
    }),
);
const server = createServer(app);
const url = (path: string) => `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/users${path}`;

const putJson = (path: string, body: unknown, user: string | null = 'u1') =>
    fetch(url(path), {
        method: 'PUT',
        headers: { 'content-type': 'application/json', ...(user ? { 'x-user': user } : {}) },
        body: JSON.stringify(body),
    });
const putImage = (kind: string, bytes: Uint8Array, contentType = 'image/png', user: string | null = 'u1') =>
    fetch(url(`/me/images/${kind}`), {
        method: 'PUT',
        headers: { 'content-type': contentType, ...(user ? { 'x-user': user } : {}) },
        body: bytes,
    });
const png = (...rest: number[]) => Uint8Array.from([1, ...rest]);
const profileOf = async (res: Response | Promise<Response>) => (await (await res).json()) as UserProfile;
const errorOf = async (res: Response) => (await res.json()) as { error: string; code: string };

const baseUser = (id: string): StoredProfileFields => ({
    id,
    name: id.toUpperCase(),
    handle: `user_${id}`,
    image: 'https://avatars.oauth.example/a.png',
    bio: null,
    status: null,
    bannerImage: null,
    links: [],
    languages: [],
});

describe('プロフィールの API', () => {
    beforeAll(async () => {
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    });
    afterAll(async () => {
        await new Promise<void>((resolve) => server.close(() => resolve()));
    });
    beforeEach(() => {
        users.rows.clear();
        images.blobs.clear();
        users.rows.set('u1', baseUser('u1'));
        users.rows.set('u2', baseUser('u2'));
        limited.count = 0;
        limited.max = Number.POSITIVE_INFINITY;
        processImage.mockClear();
    });

    describe('PUT /me/profile', () => {
        const body = { status: ' 制作中 ', bio: 'よろしく', links: ['github.com/u1'], languages: ['ja', 'en'] };

        it('ログインしていなければ 401（何も書かない）', async () => {
            expect((await putJson('/me/profile', body, null)).status).toBe(401);
            expect(users.rows.get('u1')?.status).toBeNull();
        });

        it('保存する形にそろえて置き換え、公開プロフィールの形で返す', async () => {
            const res = await putJson('/me/profile', body);
            expect(res.status).toBe(200);
            expect(res.headers.get('cache-control')).toBe('no-store');
            expect(await res.json()).toEqual({
                id: 'u1',
                name: 'U1',
                handle: 'user_u1',
                author: 'user_u1@ubichill.example',
                image: 'https://avatars.oauth.example/a.png',
                bio: 'よろしく',
                status: '制作中',
                bannerImage: null,
                links: [{ url: 'https://github.com/u1', kind: 'github' }],
                languages: ['ja', 'en'],
                // 編集のあとも公開のロールを返す（画面のバッジが消えない）
                roles: [{ id: 'r1', name: 'スタッフ', color: '#ff8800' }],
            });
            expect(users.rows.get('u2')?.status).toBeNull();
        });

        it('通らない値は 400 で、どの項目が悪いかを返し、何も書かない', async () => {
            for (const bad of [
                { ...body, links: ['javascript:alert(1)'] },
                {
                    ...body,
                    links: [
                        'https://a.example/',
                        'https://b.example/',
                        'https://c.example/',
                        'https://d.example/',
                        'https://e.example/',
                        'https://f.example/',
                    ],
                },
                { ...body, status: '1行目\n2行目' },
                { ...body, languages: ['klingon'] },
                { ...body, bio: 'x'.repeat(301) },
                { status: '', bio: '', links: [] },
                [],
            ]) {
                const res = await putJson('/me/profile', bad);
                expect(res.status, JSON.stringify(bad)).toBe(400);
                expect(await res.json()).toMatchObject({ code: 'invalid' });
            }
            expect(users.rows.get('u1')).toEqual(baseUser('u1'));
            const res = await putJson('/me/profile', {
                ...body,
                links: ['https://ok.example/', 'http://bad.example/'],
            });
            expect((await errorOf(res)).error).toMatch(/^links\.1: /);
        });

        it('本文で別人の ID や画像の URL を送っても、自分の ひとこと 等しか変えない', async () => {
            await putJson('/me/profile', { ...body, id: 'u2', image: 'https://evil.example/x.png', bannerImage: 'x' });
            expect(users.rows.get('u2')).toEqual(baseUser('u2'));
            expect(users.rows.get('u1')).toMatchObject({
                image: 'https://avatars.oauth.example/a.png',
                bannerImage: null,
            });
        });

        it('アカウントが消えていれば 404', async () => {
            expect((await putJson('/me/profile', body, 'ghost')).status).toBe(404);
        });
    });

    describe('PUT /me/images/:kind', () => {
        it('ログインしていなければ 401 で、画像を処理しない', async () => {
            expect((await putImage('avatar', png(9), 'image/png', null)).status).toBe(401);
            expect(processImage).not.toHaveBeenCalled();
        });

        it('作り直した画像を置き、ハッシュ入りの URL を users に入れる（OAuth のアイコンを置き換える）', async () => {
            const res = await putImage('avatar', png(9));
            expect(res.status).toBe(200);
            const profile = await profileOf(res);
            expect(profile.image).toMatch(
                /^https:\/\/ubichill\.example\/api\/v1\/users\/u1\/images\/avatar\/[A-Za-z0-9_-]{43}\.webp$/,
            );
            expect(users.rows.get('u1')?.image).toBe(profile.image);
            const banner = await profileOf(putImage('banner', png(8)));
            expect(banner.bannerImage).toMatch(/\/images\/banner\/[A-Za-z0-9_-]{43}\.webp$/);
            expect(banner.image).toBe(profile.image);
        });

        it('画像の種類・Content-Type が違えば、本文を読む前に断る', async () => {
            expect((await putImage('background', png(1))).status).toBe(404);
            expect((await putImage('avatar', png(1), 'application/octet-stream')).status).toBe(415);
            expect((await putImage('avatar', png(1), 'text/html')).status).toBe(415);
            expect(processImage).not.toHaveBeenCalled();
        });

        it('大きすぎる本文は 413（作り直しを始めない）', async () => {
            const res = await putImage('avatar', new Uint8Array(PROFILE_IMAGE_MAX_BYTES + 1).fill(1));
            expect(res.status).toBe(413);
            expect(await res.json()).toMatchObject({ code: 'too-large' });
            expect(processImage).not.toHaveBeenCalled();
        });

        it('Content-Type を画像と偽った別物・SVG は中身で断る', async () => {
            const notImage = await putImage('avatar', Uint8Array.from([0x3c, 0x68, 0x74]), 'image/png');
            expect(notImage.status).toBe(422);
            expect(await notImage.json()).toMatchObject({ code: 'undecodable' });
            const svg = await putImage('avatar', Uint8Array.from([2, 0]), 'image/svg+xml');
            expect(svg.status).toBe(415);
            expect(users.rows.get('u1')?.image).toBe('https://avatars.oauth.example/a.png');
            expect(images.blobs.size).toBe(0);
        });

        it('空の本文は 400', async () => {
            expect((await putImage('avatar', new Uint8Array())).status).toBe(400);
        });

        it('アップロードの回数の制限を超えたら 429', async () => {
            limited.max = 1;
            expect((await putImage('avatar', png(1))).status).toBe(200);
            expect((await putImage('avatar', png(2))).status).toBe(429);
        });

        it('作り直しが混んでいれば 503（待たせ続けない）', async () => {
            const blocker = Promise.withResolvers<void>();
            const running = gate.run(() => blocker.promise);
            const res = await putImage('avatar', png(1));
            expect(res.status).toBe(503);
            expect(await res.json()).toMatchObject({ code: 'busy' });
            blocker.resolve();
            await running;
        });
    });

    describe('GET /:userId/images/:kind/:hash.webp', () => {
        it('置いた画像を、変わらない URL として長く cache させて配る', async () => {
            const { image } = await profileOf(putImage('avatar', png(7, 7)));
            if (!image) throw new Error('アイコンの URL が無い');
            const res = await fetch(image.replace(BASE, url('').replace('/api/v1/users', '')));
            expect(res.status).toBe(200);
            expect(res.headers.get('content-type')).toBe('image/webp');
            expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
            expect(res.headers.get('x-content-type-options')).toBe('nosniff');
            expect(res.headers.get('content-security-policy')).toContain("default-src 'none'");
            expect(res.headers.get('content-security-policy')).toContain('sandbox');
            expect(res.headers.get('cross-origin-resource-policy')).toBe('cross-origin');
            expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([1, 7, 7]);
        });

        it('置き換えると前の URL は 404 になり、新しい URL は別のものになる', async () => {
            const first = (await profileOf(putImage('avatar', png(1)))).image as string;
            const second = (await profileOf(putImage('avatar', png(2)))).image as string;
            expect(second).not.toBe(first);
            const path = (u: string) => url(u.replace(`${BASE}/api/v1/users`, ''));
            const stale = await fetch(path(first));
            expect(stale.status).toBe(404);
            expect(stale.headers.get('cache-control')).toBe('no-store');
            expect((await fetch(path(second))).status).toBe(200);
        });

        it('ほかの人・ほかの種類・形の違うファイル名では返さない', async () => {
            const avatar = (await profileOf(putImage('avatar', png(3)))).image as string;
            const hash = /([A-Za-z0-9_-]{43})\.webp$/.exec(avatar)?.[1] ?? '';
            for (const path of [
                `/u2/images/avatar/${hash}.webp`,
                `/u1/images/banner/${hash}.webp`,
                `/u1/images/avatar/${hash}.png`,
                `/u1/images/avatar/${hash}`,
                `/u1/images/secret/${hash}.webp`,
                `/u1/images/avatar/..%2F${hash}.webp`,
            ]) {
                expect((await fetch(url(path))).status, path).toBe(404);
            }
        });
    });

    describe('DELETE /me/images/:kind', () => {
        const del = (kind: string, user: string | null = 'u1') =>
            fetch(url(`/me/images/${kind}`), { method: 'DELETE', headers: user ? { 'x-user': user } : {} });

        it('ログインしていなければ 401（消さない）', async () => {
            await putImage('banner', png(4));
            expect((await del('banner', null)).status).toBe(401);
            expect(images.blobs.size).toBe(1);
        });

        it('画像と URL を外す。外した画像の URL は 404 になる', async () => {
            const banner = (await profileOf(putImage('banner', png(4)))).bannerImage as string;
            const res = await del('banner');
            expect(res.status).toBe(200);
            expect((await profileOf(res)).bannerImage).toBeNull();
            expect(images.blobs.size).toBe(0);
            expect((await fetch(url(banner.replace(`${BASE}/api/v1/users`, '')))).status).toBe(404);
        });

        it('OAuth で入った外部のアイコンも外せる（既定の表示に戻る）', async () => {
            const res = await del('avatar');
            expect((await profileOf(res)).image).toBeNull();
        });

        it('ほかの人の画像は消せない（自分の分だけ）', async () => {
            await putImage('avatar', png(5), 'image/png', 'u2');
            await del('avatar', 'u1');
            expect(images.blobs.has('u2/avatar')).toBe(true);
            expect(users.rows.get('u2')?.image).toMatch(/\/u2\/images\/avatar\//);
        });

        it('知らない種類は 404', async () => {
            expect((await del('background')).status).toBe(404);
        });
    });
});
