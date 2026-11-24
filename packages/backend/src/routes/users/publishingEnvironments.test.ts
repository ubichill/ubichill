import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getSession: vi.fn(),
    hasPassword: vi.fn(async () => true),
    registerBrowser: vi.fn(async () => ({
        ok: true as const,
        created: true,
        environment: { id: 'env-1', kind: 'browser', name: 'Chrome on Mac' },
    })),
}));

vi.mock('@ubichill/db', () => ({}));
vi.mock('../../lib/auth', () => ({ auth: { api: { getSession: mocks.getSession } } }));
vi.mock('../../utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));
vi.mock('../../services/users/userService', () => ({ userService: { hasPassword: mocks.hasPassword } }));
vi.mock('../../services/roles/roleService', () => ({ roleService: {} }));
vi.mock('../../services/authors/publishingEnvironmentService', () => ({
    publishingEnvironmentService: { registerBrowser: mocks.registerBrowser },
}));

import { router } from './publishingEnvironments';

const app = express();
app.use(express.json());
app.use('/api/v1/users', router);
const server = createServer(app);

const MINUTE = 60 * 1000;
const ago = (ms: number) => new Date(Date.now() - ms);

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

const register = () =>
    fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/users/me/publishing-environments`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: 'session=x' },
        body: JSON.stringify({ publicKey: 'k', at: '2026-11-24T00:00:00Z', signature: 'sig' }),
    });

describe('POST /api/v1/users/me/publishing-environments（ブラウザで公開するときの自動の登録）', () => {
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

    it('直近の本人確認は求めない（パスワードで入ったのが何時間も前でも、公開の途中で確認を出さない）', async () => {
        mocks.getSession.mockResolvedValue(
            sessionOf({ passwordVerifiedAt: ago(5 * 60 * MINUTE), createdAt: ago(5 * 60 * MINUTE) }),
        );
        const response = await register();
        expect(response.status).toBe(201);
        expect(mocks.registerBrowser).toHaveBeenCalledTimes(1);
    });

    it('パスワードの無い人は、古いセッションでも登録できる', async () => {
        mocks.hasPassword.mockResolvedValue(false);
        mocks.getSession.mockResolvedValue(sessionOf({ passwordVerifiedAt: null, createdAt: ago(24 * 60 * MINUTE) }));
        expect((await register()).status).toBe(201);
    });

    it('パスワードを持つ人の SSO だけのセッションは、これまでどおり password-required で断る', async () => {
        mocks.getSession.mockResolvedValue(sessionOf({ passwordVerifiedAt: null, createdAt: ago(MINUTE) }));
        const response = await register();
        expect(response.status).toBe(403);
        expect(await response.json()).toMatchObject({ code: 'password-required' });
        expect(mocks.registerBrowser).not.toHaveBeenCalled();
    });
});
