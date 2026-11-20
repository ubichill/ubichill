import { describe, expect, it } from 'vitest';
import {
    authorClaimOf,
    browserEnvironmentName,
    createPublishingEnvironments,
    newEnvironmentNotice,
    type PublishingEnvironmentRow,
    registrationOutcome,
    signingKeyListOf,
} from './publishingEnvironments';

const K1 = 'A'.repeat(43);
const K2 = 'B'.repeat(43);
const _K3 = 'C'.repeat(43);
const at = (iso: string) => new Date(iso);

describe('registrationOutcome', () => {
    it('未登録の鍵は新しい公開環境として受け付ける', () => {
        expect(registrationOutcome(undefined, 'u1')).toBe('new');
    });

    it('本人の有効な鍵は登録済み（同じブラウザからの再登録で重複させない）', () => {
        expect(registrationOutcome({ userId: 'u1', revokedAt: null }, 'u1')).toBe('already-registered');
    });

    it('取り消した鍵は本人でも二度と有効にしない', () => {
        expect(registrationOutcome({ userId: 'u1', revokedAt: at('2026-09-01T00:00:00Z') }, 'u1')).toBe('revoked');
    });

    it('他人の鍵は受け付けない（取り消し済みでも）', () => {
        expect(registrationOutcome({ userId: 'u2', revokedAt: null }, 'u1')).toBe('taken');
        expect(registrationOutcome({ userId: 'u2', revokedAt: at('2026-09-01T00:00:00Z') }, 'u1')).toBe('taken');
    });
});

describe('signingKeyListOf', () => {
    it('取り消した鍵も revokedAt 付きで残す（取り消しと取得失敗を区別できるように）', () => {
        const list = signingKeyListOf(
            'youkan@ubichill.com',
            [
                {
                    id: 'e1',
                    userId: 'u1',
                    kind: 'browser',
                    name: 'Chrome on Mac',
                    publicKey: K1,
                    createdAt: at('2026-09-01T00:00:00Z'),
                    lastUsedAt: null,
                    revokedAt: at('2026-09-02T00:00:00Z'),
                },
                {
                    id: 'e2',
                    userId: 'u1',
                    kind: 'cli',
                    name: 'CLI',
                    publicKey: K2,
                    createdAt: at('2026-09-03T00:00:00Z'),
                    lastUsedAt: null,
                    revokedAt: null,
                },
            ],
            at('2026-09-29T00:00:00Z'),
        );
        expect(list).toEqual({
            account: 'youkan@ubichill.com',
            issuedAt: '2026-09-29T00:00:00.000Z',
            keys: [
                { publicKey: K1, addedAt: '2026-09-01T00:00:00.000Z', revokedAt: '2026-09-02T00:00:00.000Z' },
                { publicKey: K2, addedAt: '2026-09-03T00:00:00.000Z' },
            ],
        });
    });
});

describe('browserEnvironmentName', () => {
    it('ブラウザと OS から見分けやすい名前を作る', () => {
        expect(
            browserEnvironmentName(
                'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36',
            ),
        ).toBe('Chrome on Mac');
        expect(
            browserEnvironmentName(
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36 Edg/140.0',
            ),
        ).toBe('Edge on Windows');
        expect(
            browserEnvironmentName(
                'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
            ),
        ).toBe('Safari on iPhone');
    });

    it('分からなければ「ブラウザ」', () => {
        expect(browserEnvironmentName(undefined)).toBe('ブラウザ');
        expect(browserEnvironmentName('curl/8.0')).toBe('ブラウザ');
    });
});

describe('newEnvironmentNotice（乗っ取りに気付けるように）', () => {
    it('追加された環境の名前と、心当たりがないときの対処（漏えいとして取り消す・パスワード変更・ログアウト）を伝える', () => {
        const notice = newEnvironmentNotice({
            displayName: 'ようかん',
            environmentName: 'Chrome on Windows',
            siteUrl: 'https://ubichill.com/',
            at: new Date('2026-10-01T00:00:00Z'),
        });
        expect(notice.subject).toContain('新しい公開環境');
        expect(notice.text).toContain('Chrome on Windows');
        expect(notice.text).toContain('https://ubichill.com/ を開き、設定の「公開」');
        expect(notice.text).toContain('心当たりのない環境');
        expect(notice.text).toContain('パスワード');
        expect(notice.text).toContain('ログアウト');
    });
});

describe('authorClaimOf', () => {
    const active = { id: 'e1', userId: 'u1', revokedAt: null };
    const base = { claimed: 'alice@a.example', ownAccount: 'alice@a.example', environment: active, userId: 'u1' };

    it('本人のアカウントと本人の有効な鍵なら、その公開環境で受け付ける', () => {
        expect(authorClaimOf(base)).toEqual({ ok: true, environmentId: 'e1' });
        expect(authorClaimOf({ ...base, tokenEnvironmentId: 'e1' })).toEqual({ ok: true, environmentId: 'e1' });
    });

    it('作者の無い署名・他人のアカウント・アカウントの無い人は弾く', () => {
        expect(authorClaimOf({ ...base, claimed: undefined }).ok).toBe(false);
        expect(authorClaimOf({ ...base, claimed: 'mallory@a.example' }).ok).toBe(false);
        expect(authorClaimOf({ ...base, ownAccount: null }).ok).toBe(false);
        // 作者の表記が null でも、アカウントの無い人（ownAccount も null）を通さない
        expect(authorClaimOf({ ...base, claimed: null, ownAccount: null }).ok).toBe(false);
    });

    it('API トークンで送るなら、そのトークンの公開環境の鍵でなければ弾く（本人の別の有効な鍵でも）', () => {
        expect(authorClaimOf({ ...base, tokenEnvironmentId: 'e2' })).toMatchObject({ ok: false });
        expect(authorClaimOf({ ...base, environment: undefined, tokenEnvironmentId: 'e1' })).toMatchObject({
            ok: false,
        });
    });

    it('取り消した鍵・他人の鍵・未登録の鍵は弾く', () => {
        expect(authorClaimOf({ ...base, environment: { ...active, revokedAt: at('2026-09-01T00:00:00Z') } }).ok).toBe(
            false,
        );
        expect(authorClaimOf({ ...base, environment: { ...active, userId: 'u2' } }).ok).toBe(false);
        expect(authorClaimOf({ ...base, environment: undefined }).ok).toBe(false);
    });
});

describe('createPublishingEnvironments', () => {
    const owner = { id: 'u1', name: 'アリス', email: 'alice@example.com', handle: 'alice', emailVerified: true };
    const rowOf = (over: Partial<PublishingEnvironmentRow>): PublishingEnvironmentRow & { apiTokenHash?: string } => ({
        id: 'e?',
        userId: 'u1',
        kind: 'browser',
        name: 'x',
        publicKey: K1,
        createdAt: at('2026-10-01T00:00:00Z'),
        lastUsedAt: null,
        revokedAt: null,
        ...over,
    });

    function setup(
        options: {
            rows?: PublishingEnvironmentRow[];
            verify?: boolean;
            raceOnCreate?: boolean;
            failTouch?: boolean;
        } = {},
    ) {
        const rows = [...(options.rows ?? [])];
        const log = { keysChanged: 0, mails: [] as string[], touched: [] as string[] };
        const service = createPublishingEnvironments({
            keys: {
                listByUser: async (userId) => rows.filter((r) => r.userId === userId),
                findLocalKey: async (publicKey) => rows.find((r) => r.publicKey === publicKey),
                findActiveByTokenHash: async (hash) =>
                    rows.find((r) => (r as { apiTokenHash?: string }).apiTokenHash === hash && !r.revokedAt),
                createLocal: async (input) => {
                    // 同時の登録: 確かめた後に別のリクエストが同じ鍵を入れた
                    if (options.raceOnCreate || rows.some((r) => r.publicKey === input.publicKey)) return undefined;
                    const row = rowOf({ ...input, id: `e${rows.length + 1}` });
                    rows.push(row);
                    return row;
                },
                revoke: async (userId, id, reason) => {
                    const row = rows.find((r) => r.id === id && r.userId === userId && !r.revokedAt);
                    if (!row) return undefined;
                    Object.assign(row, { revokedAt: at('2026-10-05T00:00:00Z'), revokeReason: reason });
                    return row;
                },
                revokeAllForUser: async (userId, reason) => {
                    const targets = rows.filter((r) => r.userId === userId && !r.revokedAt);
                    for (const r of targets)
                        Object.assign(r, { revokedAt: at('2026-10-05T00:00:00Z'), revokeReason: reason });
                    return targets.length;
                },
                touch: async (id) => {
                    if (options.failTouch) throw new Error('DB が落ちている');
                    log.touched.push(id);
                },
            },
            findUser: async (id) => (id === owner.id ? owner : undefined),
            findUserByHandle: async (handle) => (handle === owner.handle ? owner : undefined),
            accountOf: (handle) => `${handle}@a.example`,
            verifyRegistration: async () => (options.verify === false ? { ok: false, reason: 'stale' } : { ok: true }),
            keysChanged: () => {
                log.keysChanged += 1;
            },
            notify: (email) => void log.mails.push(email),
            siteUrl: () => 'https://a.example/',
            now: () => at('2026-10-06T00:00:00Z'),
        });
        return { service, rows, log };
    }

    const proof = { publicKey: K1, at: '2026-10-06T00:00:00Z', signature: 'sig' };

    it('ブラウザの登録: 作ったら作者の表示を捨て直させ、本人に知らせる', async () => {
        const { service, log } = setup();
        const outcome = await service.registerBrowser(owner, proof, 'Mozilla/5.0 (Macintosh; Mac OS X) Chrome/130');
        expect(outcome).toMatchObject({ ok: true, created: true, environment: { name: 'Chrome on Mac' } });
        expect(log).toMatchObject({ keysChanged: 1, mails: ['alice@example.com'] });
    });

    it('ブラウザの登録: 証明が通らなければ何も書かない', async () => {
        const { service, rows, log } = setup({ verify: false });
        expect(await service.registerBrowser(owner, proof, undefined)).toMatchObject({ ok: false, status: 422 });
        expect(rows).toHaveLength(0);
        expect(log).toMatchObject({ keysChanged: 0, mails: [] });
    });

    it('ブラウザの登録: 本人の登録済みの鍵は作り直さず、知らせもしない', async () => {
        const { service, log } = setup({ rows: [rowOf({ id: 'e1' })] });
        expect(await service.registerBrowser(owner, proof, undefined)).toMatchObject({ ok: true, created: false });
        expect(log).toMatchObject({ keysChanged: 0, mails: [] });
    });

    it('ブラウザの登録: 取り消した鍵・他人の鍵は断る', async () => {
        const revoked = setup({ rows: [rowOf({ revokedAt: at('2026-10-01T00:00:00Z') })] });
        expect(await revoked.service.registerBrowser(owner, proof, undefined)).toMatchObject({ code: 'revoked' });
        const others = setup({ rows: [rowOf({ userId: 'u2' })] });
        expect(await others.service.registerBrowser(owner, proof, undefined)).toMatchObject({ code: 'taken' });
    });

    it('同時に同じ鍵が登録されたら（確かめた後に一意制約に当たる）taken で、捨て直しも知らせもしない', async () => {
        const { service, log } = setup({ raceOnCreate: true });
        expect(await service.registerBrowser(owner, proof, undefined)).toMatchObject({
            ok: false,
            status: 409,
            code: 'taken',
        });
        expect(
            await service.registerWithToken(owner, { kind: 'cli', name: 'cli', publicKey: K2, apiTokenHash: 'h' }),
        ).toBeUndefined();
        expect(log).toMatchObject({ keysChanged: 0, mails: [] });
    });

    it('トークン付きの登録: 本人の登録済みの鍵にも作らない（トークンは鍵ごとに 1 つ）', async () => {
        const { service, rows } = setup({ rows: [rowOf({ id: 'e1', kind: 'cli' })] });
        expect(
            await service.registerWithToken(owner, { kind: 'cli', name: 'again', publicKey: K1, apiTokenHash: 'h' }),
        ).toBeUndefined();
        expect(rows).toHaveLength(1);
        const created = await service.registerWithToken(owner, {
            kind: 'ci',
            name: 'ci',
            publicKey: K2,
            apiTokenHash: 'h2',
        });
        expect(created).toMatchObject({ kind: 'ci', publicKey: K2 });
    });

    it('取り消し: 取り消せたときだけ捨て直させる（他人のもの・取り消し済みは何もしない）', async () => {
        const { service, log } = setup({
            rows: [rowOf({ id: 'e1' }), rowOf({ id: 'e2', userId: 'u2', publicKey: K2 })],
        });
        expect(await service.revoke('u1', 'e2', 'lost')).toBeUndefined();
        expect(log.keysChanged).toBe(0);
        expect(await service.revoke('u1', 'e1', 'compromised')).toMatchObject({ revokeReason: 'compromised' });
        expect(await service.revoke('u1', 'e1', 'lost')).toBeUndefined();
        expect(log.keysChanged).toBe(1);
    });

    it('まとめて取り消し: 1 つでも取り消したら捨て直させる（公式アカウントの乗っ取り対応もここを通る）', async () => {
        const none = setup();
        expect(await none.service.revokeAll('u1', 'compromised')).toBe(0);
        expect(none.log.keysChanged).toBe(0);
        const some = setup({ rows: [rowOf({ id: 'e1' }), rowOf({ id: 'e2', publicKey: K2 })] });
        expect(await some.service.revokeAll('u1', 'compromised')).toBe(2);
        expect(some.log.keysChanged).toBe(1);
        expect(await some.service.activePublicKeysOf('u1')).toEqual([]);
    });

    it('API トークン: 取り消した公開環境・持ち主の消えた公開環境は通さない。最終利用の記録が失敗しても通す', async () => {
        const rows = [
            { ...rowOf({ id: 'e1', kind: 'cli' }), apiTokenHash: 'ok' },
            { ...rowOf({ id: 'e2', publicKey: K2, revokedAt: at('2026-10-01T00:00:00Z') }), apiTokenHash: 'revoked' },
            { ...rowOf({ id: 'e3', userId: 'gone', publicKey: 'C'.repeat(43) }), apiTokenHash: 'orphan' },
        ];
        const { service } = setup({ rows, failTouch: true });
        expect(await service.authenticateToken('ok')).toMatchObject({
            user: { id: 'u1' },
            environment: { id: 'e1', kind: 'cli' },
        });
        expect(await service.authenticateToken('revoked')).toBeUndefined();
        expect(await service.authenticateToken('orphan')).toBeUndefined();
        await expect(service.markUsed('e1')).resolves.toBeUndefined();
    });

    it('署名の作者の確認: 署名が object でなくても落ちず、本人の有効な鍵だけ通す', async () => {
        const { service } = setup({ rows: [rowOf({ id: 'e1' })] });
        expect(await service.checkAuthorClaim('not-an-object', 'u1')).toMatchObject({ ok: false });
        expect(await service.checkAuthorClaim(null, 'u1')).toMatchObject({ ok: false });
        expect(await service.checkAuthorClaim({ author: 'alice@a.example', publicKey: K1 }, 'u1')).toEqual({
            ok: true,
            environmentId: 'e1',
        });
        expect(await service.checkAuthorClaim({ author: 'alice@a.example', publicKey: 42 }, 'u1')).toMatchObject({
            ok: false,
        });
    });

    it('ほかのサーバー向けの鍵一覧: 取り消した鍵も残す。知らない作者は undefined', async () => {
        const { service } = setup({
            rows: [rowOf({ id: 'e1', revokedAt: at('2026-10-02T00:00:00Z') }), rowOf({ id: 'e2', publicKey: K2 })],
        });
        expect(await service.signingKeysOf('nobody')).toBeUndefined();
        const list = await service.signingKeysOf('alice');
        expect(list?.account).toBe('alice@a.example');
        expect(list?.keys.map((k) => [k.publicKey, k.revokedAt ?? null])).toEqual([
            [K1, '2026-10-02T00:00:00.000Z'],
            [K2, null],
        ]);
    });
});
