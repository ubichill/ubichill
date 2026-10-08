import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getSession: vi.fn(),
    issue: vi.fn(() => ({ token: 'signed-token', expiresAt: 1_300_000 })),
}));

vi.mock('@ubichill/db', () => ({ publishingEnvironmentRepository: {}, userRepository: {} }));
vi.mock('../lib/auth', () => ({ auth: { api: { getSession: mocks.getSession } } }));
vi.mock('../utils/logger', () => ({ logger: { warn: vi.fn() } }));
vi.mock('../services/serviceTokens', () => ({
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

const issue = () =>
    fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/service-tokens`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: 'session=old' },
        body: JSON.stringify({ audience: 'https://api.example.com', modId: 'my-mod' }),
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
});
