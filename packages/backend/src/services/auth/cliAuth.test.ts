import { describe, expect, it } from 'vitest';
import {
    bearerToken,
    type CliAuthRequestRow,
    createCliAuth,
    exchangeOutcome,
    loopbackRedirect,
    newApiToken,
    newUserCode,
    requestFlowOf,
    type StoredRequest,
    sha256Base64Url,
} from './cliAuth';

const NOW = new Date('2026-10-02T00:00:00Z');
const later = new Date(NOW.getTime() + 60_000);
const base = { kind: 'cli' as const, name: 'CLI', publicKey: 'A'.repeat(43) };

describe('requestFlowOf', () => {
    it('リダイレクト先と PKCE が無ければデバイス認可、組であればループバック', () => {
        expect(requestFlowOf(base)).toBe('device');
        expect(requestFlowOf({ ...base, redirectUri: 'http://127.0.0.1:5000/cb', codeChallenge: 'C'.repeat(43) })).toBe(
            'loopback',
        );
    });

    it('片方だけ・ループバック以外のリダイレクト先は拒否する', () => {
        expect(requestFlowOf({ ...base, redirectUri: 'http://127.0.0.1:5000/cb' })).toHaveProperty('error');
        expect(requestFlowOf({ ...base, codeChallenge: 'C'.repeat(43) })).toHaveProperty('error');
        expect(
            requestFlowOf({ ...base, redirectUri: 'https://evil.example/cb', codeChallenge: 'C'.repeat(43) }),
        ).toHaveProperty('error');
    });
});

describe('exchangeOutcome', () => {
    const verifier = 'verifier-'.padEnd(50, 'x');
    const loopback: StoredRequest = {
        status: 'approved',
        expiresAt: later,
        codeChallenge: sha256Base64Url(verifier),
        authCodeHash: sha256Base64Url('the-code'),
        deviceCodeHash: null,
    };
    const device: StoredRequest = {
        status: 'pending',
        expiresAt: later,
        codeChallenge: null,
        authCodeHash: null,
        deviceCodeHash: sha256Base64Url('device-code'),
    };

    it('ループバックは認可コードと PKCE の両方が一致したときだけ引き換えられる', () => {
        expect(exchangeOutcome(loopback, { code: 'the-code', codeVerifier: verifier }, NOW)).toEqual({ ok: true });
        // 認可コードを横取りしても、PKCE の verifier を知らなければ引き換えられない
        expect(exchangeOutcome(loopback, { code: 'the-code', codeVerifier: 'guess' }, NOW)).toMatchObject({
            ok: false,
            code: 'invalid-grant',
        });
        expect(exchangeOutcome(loopback, { code: 'other', codeVerifier: verifier }, NOW)).toMatchObject({ ok: false });
    });

    it('デバイス認可は、承認されるまで 428（ポーリングで待つ）、承認後に引き換えられる', () => {
        expect(exchangeOutcome(device, { deviceCode: 'device-code' }, NOW)).toMatchObject({
            ok: false,
            status: 428,
            code: 'authorization-pending',
        });
        expect(exchangeOutcome({ ...device, status: 'approved' }, { deviceCode: 'device-code' }, NOW)).toEqual({
            ok: true,
        });
    });

    it('デバイスコードが違えば、承認待ちかどうかも教えない', () => {
        expect(exchangeOutcome(device, { deviceCode: 'wrong' }, NOW)).toMatchObject({ code: 'invalid-grant' });
    });

    it('失効・存在しない要求は 404、引き換え済みは 409（2 回目の引き換えは通らない）', () => {
        expect(exchangeOutcome(undefined, { deviceCode: 'x' }, NOW)).toMatchObject({ status: 404 });
        expect(exchangeOutcome({ ...device, expiresAt: NOW }, { deviceCode: 'device-code' }, NOW)).toMatchObject({
            status: 404,
        });
        expect(
            exchangeOutcome({ ...loopback, status: 'consumed' }, { code: 'the-code', codeVerifier: verifier }, NOW),
        ).toMatchObject({ status: 409 });
    });

    it('承認されていないループバックの要求は引き換えられない', () => {
        expect(
            exchangeOutcome({ ...loopback, status: 'pending' }, { code: 'the-code', codeVerifier: verifier }, NOW),
        ).toMatchObject({ ok: false, code: 'invalid-grant' });
    });
});

describe('newUserCode / newApiToken / bearerToken', () => {
    it('user code は XXXX-XXXX で、紛らわしい文字を使わない', () => {
        const seq = [0, 1, 2, 3, 19, 18, 17, 16];
        const code = newUserCode(() => seq.shift() ?? 0);
        expect(code).toBe('BCDF-ZXWV');
        expect(newUserCode()).toMatch(/^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/);
    });

    it('トークンは ubi_ 付きで毎回違い、Authorization ヘッダーから取り出せる', () => {
        const token = newApiToken();
        expect(token).toMatch(/^ubi_[A-Za-z0-9_-]{43}$/);
        expect(newApiToken()).not.toBe(token);
        expect(bearerToken(`Bearer ${token}`)).toBe(token);
        expect(bearerToken(`bearer ${token}`)).toBe(token);
        expect(bearerToken('Bearer something-else')).toBeUndefined();
        expect(bearerToken(undefined)).toBeUndefined();
    });
});

describe('loopbackRedirect', () => {
    it('認可コードと state を付ける（既存のクエリは残す）', () => {
        expect(loopbackRedirect('http://127.0.0.1:5000/cb?x=1', 'c0de', 'st')).toBe(
            'http://127.0.0.1:5000/cb?x=1&code=c0de&state=st',
        );
    });
});

describe('createCliAuth', () => {
    const user = { id: 'u1', name: 'アリス', email: 'a@example.com', handle: 'alice', emailVerified: true };
    const hash = (value: string) => `h(${value})`;

    function setup(
        options: {
            proof?: boolean;
            consumeRace?: boolean;
            approveRace?: boolean;
            keyTaken?: boolean;
            users?: string[];
        } = {},
    ) {
        const requests: CliAuthRequestRow[] = [];
        const registered: Array<{ publicKey: string; apiTokenHash: string }> = [];
        const counter = { n: 0 };
        const auth = createCliAuth({
            requests: {
                create: async (input) =>
                    void requests.push({ ...input, status: 'pending', authCodeHash: null, userId: null }),
                findActive: async (id) => requests.find((r) => r.id === id && r.expiresAt > NOW),
                findActiveByUserCode: async (code) => requests.find((r) => r.userCode === code && r.expiresAt > NOW),
                approve: async (id, userId, authCodeHash) => {
                    const row = requests.find((r) => r.id === id && r.status === 'pending');
                    if (!row || options.approveRace) return undefined;
                    return Object.assign(row, { status: 'approved', userId, authCodeHash });
                },
                consume: async (id) => {
                    const row = requests.find((r) => r.id === id && r.status === 'approved');
                    if (!row || options.consumeRace) return undefined;
                    return Object.assign(row, { status: 'consumed' });
                },
            },
            findUser: async (id) => ((options.users ?? ['u1']).includes(id) ? { ...user, id } : undefined),
            environments: {
                registerWithToken: async (_owner, input) => {
                    if (options.keyTaken) return undefined;
                    registered.push(input);
                    return {
                        id: 'e1',
                        kind: 'cli',
                        name: input.name,
                        publicKey: input.publicKey,
                        createdAt: NOW.toISOString(),
                        lastUsedAt: null,
                        revokedAt: null,
                        revokeReason: null,
                    };
                },
            },
            verifyProof: async () => options.proof !== false,
            accountOf: (handle) => `${handle}@a.example`,
            secrets: {
                random: (bytes) => `r${bytes}-${++counter.n}`,
                userCode: () => 'BCDF-GHJK',
                apiToken: () => 'ubi_token',
            },
            hash,
            now: () => NOW,
        });
        return { auth, requests, registered };
    }

    const loopback = { ...base, redirectUri: 'http://127.0.0.1:5000/cb', codeChallenge: hash('verifier') };

    it('要求: デバイス認可はデバイスコードの hash だけを保存し、生の値は CLI にだけ返す', async () => {
        const { auth, requests } = setup();
        const created = await auth.createRequest(base);
        if (!created.ok) throw new Error(created.error);
        expect(created).toMatchObject({ userCode: 'BCDF-GHJK', deviceCode: expect.any(String) });
        expect(requests[0]?.deviceCodeHash).toBe(hash(created.deviceCode ?? ''));
        expect(JSON.stringify(requests)).not.toContain(`"${created.deviceCode}"`);
    });

    it('要求: リダイレクト先だけ・ループバックでない宛先は保存しない', async () => {
        const { auth, requests } = setup();
        expect(await auth.createRequest({ ...base, redirectUri: 'http://127.0.0.1:5000/cb' })).toMatchObject({
            ok: false,
            status: 400,
        });
        expect(await auth.createRequest({ ...loopback, redirectUri: 'https://evil.example/cb' })).toMatchObject({
            ok: false,
        });
        expect(requests).toHaveLength(0);
    });

    it('承認: ループバックは認可コードの hash を保存し、state 付きのリダイレクト先を返す。二度目は承認できない', async () => {
        const { auth, requests } = setup();
        const created = await auth.createRequest(loopback);
        if (!created.ok) throw new Error(created.error);
        const approved = await auth.approve('u1', created.requestId, 'st');
        if (!approved.ok) throw new Error(approved.error);
        const code = new URL(approved.redirect ?? '').searchParams.get('code') ?? '';
        expect(new URL(approved.redirect ?? '').searchParams.get('state')).toBe('st');
        expect(requests[0]).toMatchObject({ status: 'approved', userId: 'u1', authCodeHash: hash(code) });
        expect(await auth.approve('u1', created.requestId, undefined)).toMatchObject({ ok: false, status: 404 });
    });

    it('承認: 同時に承認されて負けた側は 409、消えたユーザーは 404', async () => {
        const race = setup({ approveRace: true });
        const created = await race.auth.createRequest(base);
        if (!created.ok) throw new Error(created.error);
        expect(await race.auth.approve('u1', created.requestId, undefined)).toMatchObject({ ok: false, status: 409 });
        expect(await race.auth.approve('ghost', created.requestId, undefined)).toMatchObject({
            ok: false,
            status: 404,
        });
    });

    async function approvedDevice(options: Parameters<typeof setup>[0] = {}) {
        const ctx = setup(options);
        const created = await ctx.auth.createRequest(base);
        if (!created.ok || !created.deviceCode) throw new Error('要求を作れません');
        await ctx.auth.approve('u1', created.requestId, undefined);
        return { ...ctx, requestId: created.requestId, deviceCode: created.deviceCode };
    }

    it('引き換え: 承認前は 428 で、要求を使い切らない（デバイス認可のポーリングは待ち続ける）', async () => {
        const { auth, requests } = setup();
        const created = await auth.createRequest(base);
        if (!created.ok || !created.deviceCode) throw new Error('要求を作れません');
        expect(await auth.exchange(created.requestId, 'sig', { deviceCode: created.deviceCode })).toMatchObject({
            status: 428,
        });
        expect(requests[0]?.status).toBe('pending');
    });

    it('引き換え: 鍵の所有を証明できなければ使い切らない（正しい CLI がやり直せる）', async () => {
        const { auth, requests, requestId, deviceCode } = await approvedDevice({ proof: false });
        expect(await auth.exchange(requestId, 'sig', { deviceCode })).toMatchObject({
            status: 400,
            code: 'invalid-proof',
        });
        expect(requests[0]?.status).toBe('approved');
    });

    it('引き換え: 通ればトークンを返し、保存するのはトークンの hash だけ', async () => {
        const { auth, registered, requestId, deviceCode } = await approvedDevice();
        const outcome = await auth.exchange(requestId, 'sig', { deviceCode });
        expect(outcome).toMatchObject({
            ok: true,
            token: 'ubi_token',
            account: 'alice@a.example',
            environment: { id: 'e1' },
        });
        expect(registered).toEqual([
            expect.objectContaining({ publicKey: base.publicKey, apiTokenHash: hash('ubi_token') }),
        ]);
        expect(await auth.exchange(requestId, 'sig', { deviceCode })).toMatchObject({ status: 409, code: 'consumed' });
    });

    it('引き換え: 同時に引き換えられて負けた側は 409 で、公開環境を作らない', async () => {
        const { auth, registered, requestId, deviceCode } = await approvedDevice({ consumeRace: true });
        expect(await auth.exchange(requestId, 'sig', { deviceCode })).toMatchObject({ status: 409, code: 'consumed' });
        expect(registered).toHaveLength(0);
    });

    it('引き換え: 鍵が登録済み・承認した人が消えた場合は 409 で、要求は使い切る（同じ鍵では作れない）', async () => {
        const taken = await approvedDevice({ keyTaken: true });
        expect(await taken.auth.exchange(taken.requestId, 'sig', { deviceCode: taken.deviceCode })).toMatchObject({
            status: 409,
            code: 'taken',
        });
        expect(taken.requests[0]?.status).toBe('consumed');

        const gone = await approvedDevice();
        // 承認したあとで、その人がアカウントを消した
        for (const row of gone.requests) row.userId = 'deleted';
        expect(await gone.auth.exchange(gone.requestId, 'sig', { deviceCode: gone.deviceCode })).toMatchObject({
            status: 409,
            code: 'author-not-found',
        });
        expect(gone.registered).toHaveLength(0);
    });

    it('引き換え: デバイスコードを知らなければ、承認済みでも引き換えられない', async () => {
        const { auth, requestId } = await approvedDevice();
        expect(await auth.exchange(requestId, 'sig', { deviceCode: 'guess' })).toMatchObject({
            status: 400,
            code: 'invalid-grant',
        });
        expect(await auth.exchange(requestId, 'sig', { code: 'x', codeVerifier: 'verifier' })).toMatchObject({
            status: 400,
            code: 'invalid-grant',
        });
    });
});
