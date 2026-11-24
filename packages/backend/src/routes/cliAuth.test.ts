import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getSession: vi.fn(),
    hasPassword: vi.fn(async () => true),
    approve: vi.fn(async () => ({ ok: true as const, redirect: null })),
}));

vi.mock('@ubichill/db', () => ({}));
vi.mock('../lib/auth', () => ({ auth: { api: { getSession: mocks.getSession } } }));
vi.mock('../utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));
vi.mock('../services/users/userService', () => ({ userService: { hasPassword: mocks.hasPassword } }));
vi.mock('../services/roles/roleService', () => ({ roleService: {} }));
vi.mock('../services/authors/publishingEnvironmentService', () => ({ publishingEnvironmentService: {} }));
vi.mock('../services/auth/cliAuthService', () => ({ cliAuthService: { approve: mocks.approve } }));

import { router } from './cliAuth';

const app = express();
app.use(express.json());
app.use('/api/v1/cli-auth', router);
const server = createServer(app);

const MINUTE = 60 * 1000;
const ago = (ms: number) => new Date(Date.now() - ms);

/** DB のセッション。パスワードを確かめた時刻（null は SSO だけで入った）と、ログインした時刻。 */
function sessionOf(facts: { passwordVerifiedAt: Date | null; createdAt: Date }) {
    return {
        user: { id: 'user-1', email: 'user@example.com', name: 'User', emailVerified: true },
        session: {
            id: 'session-1',
            userId: 'user-1',
            token: 'session-token',
            expiresAt: new Date(Date.now() + 60 * MINUTE),
            ...facts,
        },
    };
}

const approve = () =>
    fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/cli-auth/requests/req-1/approve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: 'session=x' },
        body: JSON.stringify({ state: 's' }),
    });

describe('POST /api/v1/cli-auth/requests/:id/approve の本人確認（CLI・CI の追加は直近の本人確認）', () => {
    beforeAll(async () => {
        await new Promise<void>((resolve, reject) => {
            server.once('error', reject);
            server.listen(0, '127.0.0.1', resolve);
        });
    });
    afterAll(async () => {
        await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    });
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.hasPassword.mockResolvedValue(true);
    });

    it('パスワードを 10 分以内に確かめたセッションなら承認する', async () => {
        mocks.getSession.mockResolvedValue(
            sessionOf({ passwordVerifiedAt: ago(2 * MINUTE), createdAt: ago(60 * MINUTE) }),
        );
        const response = await approve();
        expect(response.status).toBe(200);
        expect(mocks.approve).toHaveBeenCalledWith('user-1', 'req-1', 's');
    });

    it('パスワードで入っても 10 分を過ぎたセッションは reauth-required で断り、承認しない', async () => {
        mocks.getSession.mockResolvedValue(
            sessionOf({ passwordVerifiedAt: ago(11 * MINUTE), createdAt: ago(11 * MINUTE) }),
        );
        const response = await approve();
        expect(response.status).toBe(403);
        expect(await response.json()).toMatchObject({ code: 'reauth-required' });
        expect(mocks.approve).not.toHaveBeenCalled();
    });

    it('パスワードを持つ人が SSO で入った直後のセッションでも、パスワードの本人確認を求める', async () => {
        mocks.getSession.mockResolvedValue(sessionOf({ passwordVerifiedAt: null, createdAt: ago(MINUTE) }));
        const response = await approve();
        expect(response.status).toBe(403);
        expect(await response.json()).toMatchObject({ code: 'reauth-required' });
        expect(mocks.approve).not.toHaveBeenCalled();
    });

    it('パスワードの無い人（フェディバースで登録）は、10 分以内にログインし直したセッションなら承認する', async () => {
        mocks.hasPassword.mockResolvedValue(false);
        mocks.getSession.mockResolvedValue(sessionOf({ passwordVerifiedAt: null, createdAt: ago(3 * MINUTE) }));
        expect((await approve()).status).toBe(200);
        mocks.getSession.mockResolvedValue(sessionOf({ passwordVerifiedAt: null, createdAt: ago(30 * MINUTE) }));
        const stale = await approve();
        expect(stale.status).toBe(403);
        expect(await stale.json()).toMatchObject({ code: 'reauth-required' });
        expect(mocks.approve).toHaveBeenCalledTimes(1);
    });

    it('DB で失効したセッションは、クッキーのキャッシュに残っていても 401', async () => {
        const recent = sessionOf({ passwordVerifiedAt: ago(MINUTE), createdAt: ago(MINUTE) });
        mocks.getSession.mockImplementation(async ({ query }: { query?: { disableCookieCache?: boolean } }) =>
            query?.disableCookieCache ? null : recent,
        );
        expect((await approve()).status).toBe(401);
        expect(mocks.approve).not.toHaveBeenCalled();
    });
});
