import type { ModLockEntry, ModSignatureVerdict } from '@ubichill/shared';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api', () => ({ API_BASE: 'https://ubichill.example' }));

import { checkModAuthor, createSignatureVerifier, type FetchedJson, isUnsignedModAllowed } from './modSignature';

const ORIGIN = 'https://ubichill.example';

describe('isUnsignedModAllowed', () => {
    it('本番の Host は、自分のオリジンの mod でも未署名を許さない', () => {
        expect(isUnsignedModAllowed({ devHost: false, baseUrl: '/mods', origin: ORIGIN })).toBe(false);
        expect(isUnsignedModAllowed({ devHost: false, baseUrl: `${ORIGIN}/mods`, origin: ORIGIN })).toBe(false);
    });

    it('開発用の Host は、自分のオリジンの mod だけ未署名を許す', () => {
        expect(isUnsignedModAllowed({ devHost: true, baseUrl: '/mods', origin: ORIGIN })).toBe(true);
        expect(isUnsignedModAllowed({ devHost: true, baseUrl: `${ORIGIN}/mods`, origin: ORIGIN })).toBe(true);
    });

    it.each([
        'https://evil.example/mods',
        '//evil.example/mods',
        'https://ubichill.example.evil.test/mods',
        'https://ubichill.example@evil.test/mods',
        'http://ubichill.example/mods',
        'https://ubichill.example:8443/mods',
        '\\\\evil.example/mods',
        'https://',
    ])('開発用の Host でも、ほかのオリジン（%s）の未署名 mod は許さない', (baseUrl) => {
        expect(isUnsignedModAllowed({ devHost: true, baseUrl, origin: ORIGIN })).toBe(false);
    });
});

describe('createSignatureVerifier', () => {
    const entry: ModLockEntry = {
        id: 'pen',
        version: '1.0.0',
        manifestIntegrity: `sha256-${'A'.repeat(43)}=`,
        components: {},
    };
    const verified: ModSignatureVerdict = {
        status: 'verified',
        author: 'alice@example.com',
        publicKey: 'k',
        contentHash: 'h',
    };
    const pending: ModSignatureVerdict = { status: 'rejected', reason: 'author-pending' };

    const run = (answers: (ModSignatureVerdict | Error)[]) => {
        const slept: number[] = [];
        const queue = [...answers];
        const request = vi.fn(async () => {
            const next = queue.shift();
            if (next === undefined) throw new Error('呼びすぎ');
            if (next instanceof Error) throw next;
            return next;
        });
        const verify = createSignatureVerifier({
            request,
            sleep: async (ms) => {
                slept.push(ms);
            },
            retryDelays: [10, 20],
        });
        return { verdict: verify(entry, {}), request, slept };
    };

    it('確認できたら 1 回で終わる', async () => {
        const { verdict, request, slept } = run([verified]);
        expect(await verdict).toEqual(verified);
        expect(request).toHaveBeenCalledTimes(1);
        expect(slept).toEqual([]);
    });

    it('確定した拒否（作者ではない鍵・改ざん）は確認し直さない', async () => {
        for (const reason of ['author-unconfirmed', 'signature-invalid', 'signature-content-mismatch'] as const) {
            const { verdict, request } = run([{ status: 'rejected', reason }, verified]);
            expect(await verdict).toEqual({ status: 'rejected', reason });
            expect(request).toHaveBeenCalledTimes(1);
        }
    });

    it('いまは確認できないときだけ、間をあけて確認し直す', async () => {
        const { verdict, slept } = run([pending, new Error('offline'), verified]);
        expect(await verdict).toEqual(verified);
        expect(slept).toEqual([10, 20]);
    });

    it('確認し直しても駄目なら、確認済みにせず pending のまま返す', async () => {
        const { verdict, request, slept } = run([new Error('offline'), pending, pending, verified]);
        expect(await verdict).toEqual(pending);
        expect(request).toHaveBeenCalledTimes(3);
        expect(slept).toEqual([10, 20]);
    });
});

describe('checkModAuthor', () => {
    const BASE = 'https://mods.example';
    const lock = { id: 'pen', version: '1.0.0', manifestIntegrity: `sha256-${'A'.repeat(43)}=`, components: {} };
    const LOCK_URL = `${BASE}/pen/v1.0.0/lock.json`;
    const SIG_URL = `${BASE}/pen/v1.0.0/lock.sig.json`;
    const found = (value: unknown): FetchedJson => ({ found: true, value });
    const missing: FetchedJson = { found: false };

    const check = (
        files: Record<string, FetchedJson | Error>,
        verdict: ModSignatureVerdict | Error = {
            status: 'verified',
            author: 'alice@example.com',
            publicKey: 'k',
            contentHash: 'h',
        },
    ) => {
        const verify = vi.fn(async () => {
            if (verdict instanceof Error) throw verdict;
            return verdict;
        });
        const result = checkModAuthor(
            {
                fetchJson: async (url) => {
                    const hit = files[url] ?? missing;
                    if (hit instanceof Error) throw hit;
                    return hit;
                },
                verify,
            },
            BASE,
            'pen',
            '1.0.0',
        );
        return { result, verify };
    };

    it('指定した版の lock と署名を確認して、作者を返す', async () => {
        const { result, verify } = check({ [LOCK_URL]: found(lock), [SIG_URL]: found({ sig: 1 }) });
        expect(await result).toEqual({ status: 'verified', author: 'alice@example.com' });
        expect(verify).toHaveBeenCalledWith(lock, { sig: 1 });
    });

    it('署名ファイルが無いと確定したときだけ「署名なし」', async () => {
        const { result, verify } = check({ [LOCK_URL]: found(lock) });
        expect(await result).toEqual({ status: 'unsigned' });
        expect(verify).not.toHaveBeenCalled();
    });

    it('通信の失敗・サーバーエラーは「署名なし」にせず、確認できないと返す', async () => {
        const offline = new Error('offline');
        for (const files of [
            { [LOCK_URL]: found(lock), [SIG_URL]: offline },
            { [LOCK_URL]: offline, [SIG_URL]: found({}) },
        ]) {
            expect(await check(files).result).toEqual({ status: 'unavailable' });
        }
        const files = { [LOCK_URL]: found(lock), [SIG_URL]: found({}) };
        expect(await check(files, offline).result).toEqual({ status: 'unavailable' });
        expect(await check(files, { status: 'rejected', reason: 'author-pending' }).result).toEqual({
            status: 'unavailable',
        });
    });

    it('確定した拒否（取り消された鍵・改ざん）は理由つきで返す', async () => {
        const files = { [LOCK_URL]: found(lock), [SIG_URL]: found({}) };
        for (const reason of ['author-unconfirmed', 'signature-content-mismatch'] as const) {
            expect(await check(files, { status: 'rejected', reason }).result).toEqual({ status: 'rejected', reason });
        }
    });

    it('lock が無い mod（実行するコードが無い）は署名の対象外。lock として読めないものは確認できない扱い', async () => {
        expect(await check({ [SIG_URL]: found({}) }).result).toEqual({ status: 'data-only' });
        expect(await check({ [LOCK_URL]: found({ id: 'pen' }), [SIG_URL]: found({}) }).result).toEqual({
            status: 'unavailable',
        });
    });
});
