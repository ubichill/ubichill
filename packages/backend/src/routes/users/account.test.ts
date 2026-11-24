import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import express, { type RequestHandler } from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getSession: vi.fn(),
    hasPassword: vi.fn(async () => false),
    start: vi.fn(async () => ({ ok: true as const, status: 'sent' as const })),
    verify: vi.fn(async () => ({ ok: true as const, status: 'linked' as const })),
    unlink: vi.fn(async () => ({ status: 'unlinked' as const })),
    pass: ((_req, _res, next) => next()) satisfies RequestHandler,
}));

vi.mock('@ubichill/db', () => ({}));
vi.mock('../../lib/auth', () => ({ auth: { api: { getSession: mocks.getSession } } }));
vi.mock('../../lib/rateLimit', () => ({ sharedLimiter: () => mocks.pass, perUserLimiter: () => mocks.pass }));
vi.mock('../../utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));
vi.mock('../../services/users/userService', () => ({ userService: { hasPassword: mocks.hasPassword } }));
vi.mock('../../services/auth/emailLinkService', () => ({
    emailLinkService: { start: mocks.start, verify: mocks.verify },
}));
vi.mock('../../services/roles/roleService', () => ({ roleService: {} }));
vi.mock('../../services/authors/publishingEnvironmentService', () => ({ publishingEnvironmentService: {} }));
vi.mock('../../services/auth/accountSessions', () => ({ accountSessionService: {} }));
vi.mock('../../services/auth/loginMethods', () => ({ loginMethodService: { unlink: mocks.unlink } }));
vi.mock('../../services/users/accountDeletionService', () => ({ accountDeletionService: {} }));
vi.mock('../../services/users/displayName', () => ({ changeDisplayName: vi.fn(), displayNameAvailableAtOf: vi.fn() }));
vi.mock('../../services/users/publicProfile', () => ({ publicProfileOf: vi.fn() }));

import { router } from './account';

const app = express();
app.use(express.json());
app.use('/api/v1/users', router);
const server = createServer(app);

const MINUTE = 60 * 1000;
const ago = (ms: number) => new Date(Date.now() - ms);

/** フェディバースだけで入った人（パスワードなし）のセッション。 */
function ssoSession(signedInAgo: number) {
    return {
        user: { id: 'user-1', email: 'x@sso.invalid', name: 'User', emailVerified: true },
        session: {
            id: 'session-1',
            userId: 'user-1',
            token: 'session-token',
            expiresAt: new Date(Date.now() + 60 * MINUTE),
            createdAt: ago(signedInAgo),
            passwordVerifiedAt: null,
        },
    };
}

/** パスワードを持つ人のセッション（パスワードを確かめた時刻）。 */
function passwordSession(verifiedAgo: number) {
    const base = ssoSession(verifiedAgo);
    return { ...base, session: { ...base.session, passwordVerifiedAt: ago(verifiedAgo) } };
}

const removeLoginMethod = (id: string) =>
    fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/users/me/login-methods/${id}`, {
        method: 'DELETE',
        headers: { cookie: 'session=x' },
    });

const post = (path: string, body: unknown) =>
    fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/users${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: 'session=x' },
        body: JSON.stringify(body),
    });

beforeAll(async () => {
    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
});
afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

describe('メールアドレスとパスワードの追加（/me/email・/me/email/verify）は直近の本人確認', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.hasPassword.mockResolvedValue(false);
    });

    it('奪った古いセッションでは、自分のアドレスとパスワードを足して本人確認を済ませたことにできない（403 reauth-required）', async () => {
        mocks.getSession.mockResolvedValue(ssoSession(60 * MINUTE));
        const started = await post('/me/email', { email: 'attacker@example.com', password: 'password-123' });
        expect(started.status).toBe(403);
        expect(await started.json()).toMatchObject({ code: 'reauth-required' });
        const verified = await post('/me/email/verify', { code: '123456' });
        expect(verified.status).toBe(403);
        expect(await verified.json()).toMatchObject({ code: 'reauth-required' });
        expect(mocks.start).not.toHaveBeenCalled();
        expect(mocks.verify).not.toHaveBeenCalled();
    });

    it('10 分以内にログインし直したセッションなら、コードを送って足せる（セッションの時刻を service に渡す）', async () => {
        const recent = ssoSession(2 * MINUTE);
        mocks.getSession.mockResolvedValue(recent);
        expect((await post('/me/email', { email: 'me@example.com', password: 'password-123' })).status).toBe(200);
        expect((await post('/me/email/verify', { code: '123456' })).status).toBe(204);
        expect(mocks.start).toHaveBeenCalledWith(
            expect.objectContaining({
                userId: 'user-1',
                session: expect.objectContaining({ id: 'session-1', createdAt: recent.session.createdAt }),
            }),
        );
        expect(mocks.verify).toHaveBeenCalledWith(
            expect.objectContaining({ session: expect.objectContaining({ id: 'session-1' }), code: '123456' }),
        );
    });
});

describe('ログイン方法を外す（DELETE /me/login-methods/:id）は直近の本人確認', () => {
    beforeEach(() => vi.clearAllMocks());

    it('奪った古いセッションでは、本人のフェディバースのログインを外せない（403 reauth-required）', async () => {
        mocks.hasPassword.mockResolvedValue(false);
        mocks.getSession.mockResolvedValue(ssoSession(60 * MINUTE));
        const refused = await removeLoginMethod('acc-victim');
        expect(refused.status).toBe(403);
        expect(await refused.json()).toMatchObject({ code: 'reauth-required' });
        mocks.hasPassword.mockResolvedValue(true);
        mocks.getSession.mockResolvedValue(passwordSession(30 * MINUTE));
        expect((await removeLoginMethod('acc-victim')).status).toBe(403);
        expect(mocks.unlink).not.toHaveBeenCalled();
    });

    it('ログインし直した・パスワードを入れ直した直後なら外せる', async () => {
        mocks.hasPassword.mockResolvedValue(false);
        mocks.getSession.mockResolvedValue(ssoSession(MINUTE));
        expect((await removeLoginMethod('acc-1')).status).toBe(204);
        mocks.hasPassword.mockResolvedValue(true);
        mocks.getSession.mockResolvedValue(passwordSession(MINUTE));
        expect((await removeLoginMethod('acc-2')).status).toBe(204);
        expect(mocks.unlink).toHaveBeenCalledWith('user-1', 'acc-1', 'session-1');
        expect(mocks.unlink).toHaveBeenCalledTimes(2);
    });
});
