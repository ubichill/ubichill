import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getSession: vi.fn(),
    issue: vi.fn(() => ({ token: 'signed-token', expiresAt: 1_300_000 })),
    isAuthorKey: vi.fn(async () => ({ status: 'unconfirmed' as const })),
}));

vi.mock('@ubichill/db', () => ({ authorKeyRepository: {}, userRepository: {} }));
vi.mock('../lib/auth', () => ({ auth: { api: { getSession: mocks.getSession } } }));
vi.mock('../utils/logger', () => ({ logger: { warn: vi.fn() } }));
vi.mock('../services/authorKeyStore', () => ({ isAuthorKey: mocks.isAuthorKey }));
vi.mock('../services/serviceTokens', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../services/serviceTokens')>()),
    serviceTokenIssuerFromEnv: () => ({
        issuer: 'https://ubichill.example',
        issue: mocks.issue,
        jwks: () => ({ keys: [] }),
    }),
}));

import { router } from './serviceTokens';

const app = express();
app.use(express.json());
app.use('/api/v1/service-tokens', router);
const server = createServer(app);
const session = {
    user: { id: 'user-1', email: 'user@example.com', name: 'User', emailVerified: true },
    session: { id: 'session-1', userId: 'user-1', token: 'session-token', expiresAt: new Date(2_000_000) },
};

const issue = (extra: Record<string, unknown> = {}) =>
    fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/service-tokens`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: 'session=old' },
        body: JSON.stringify({ audience: 'https://api.example.com', modId: 'my-mod', ...extra }),
    });

describe('POST /api/v1/service-tokens のセッション確認', () => {
    beforeAll(async () => {
        await new Promise<void>((resolve, reject) => {
            server.once('error', reject);
            server.listen(0, '127.0.0.1', resolve);
        });
    });
    afterAll(async () => {
        await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    });
    beforeEach(() => vi.clearAllMocks());

    it('DB で失効していれば、cookie キャッシュにセッションが残っていても発行しない', async () => {
        mocks.getSession.mockImplementation(async ({ query }: { query?: { disableCookieCache?: boolean } }) =>
            query?.disableCookieCache ? null : session,
        );
        const response = await issue();
        expect(response.status).toBe(401);
        expect(mocks.issue).not.toHaveBeenCalled();
    });

    it('有効なセッションの利用者にだけ、キャッシュ不可の身元証明を発行する', async () => {
        mocks.getSession.mockResolvedValue(session);
        const response = await issue();
        expect(response.status).toBe(200);
        expect(response.headers.get('cache-control')).toBe('no-store');
        expect(await response.json()).toMatchObject({ token: 'signed-token' });
        expect(mocks.issue).toHaveBeenCalledWith({
            userId: 'user-1',
            audience: 'https://api.example.com',
            modId: 'my-mod',
        });
    });

    it('付けた mod の署名が通らなければ、理由つきで断り、発行しない', async () => {
        mocks.getSession.mockResolvedValue(session);
        const entry = {
            id: 'my-mod',
            version: '1.0.0',
            manifestIntegrity: `sha256-${'A'.repeat(43)}=`,
            components: {},
        };
        const response = await issue({ authorProof: { entry, signature: { forged: true } } });
        expect(response.status).toBe(403);
        expect(await response.json()).toMatchObject({ code: 'signature-malformed' });
        const mismatched = await issue({ authorProof: { entry: { ...entry, id: 'other' }, signature: {} } });
        expect(mismatched.status).toBe(400);
        expect(await mismatched.json()).toMatchObject({ code: 'mod-mismatch' });
        expect(mocks.issue).not.toHaveBeenCalled();
        expect(mocks.isAuthorKey).not.toHaveBeenCalled();
    });

    it('lock の形をしていない証明は 400', async () => {
        mocks.getSession.mockResolvedValue(session);
        for (const authorProof of ['x', { entry: 'x' }, { entry: { id: 'my-mod' } }]) {
            const response = await issue({ authorProof });
            expect(response.status).toBe(400);
            // 宛先ではなく依頼の形の誤りとして返す
            expect(await response.json()).toMatchObject({ code: 'invalid-request' });
        }
        for (const audience of ['http://api.example.com', 'not a url', 42]) {
            const response = await issue({ audience });
            expect(response.status).toBe(400);
            expect(await response.json()).toMatchObject({ code: 'audience-invalid' });
        }
        expect(mocks.issue).not.toHaveBeenCalled();
    });
});
