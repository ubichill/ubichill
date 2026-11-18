import { describe, expect, it } from 'vitest';
import {
    CAVAGE_MAX_SIGNATURE_CHARS,
    type CavageMessage,
    cavageSigningString,
    digestHeader,
    parseCavageSignature,
    readCavageSignature,
    readDigestHeader,
    signCavage,
    verifyCavageSignature,
} from './cavageSignature';

const NOW = Date.parse('2026-11-09T00:00:00Z') / 1000;
const DATE = new Date(NOW * 1000).toUTCString();

/** Mastodon が inbox へ送る形。 */
const message = (headers: Record<string, string>, method = 'POST', path = '/ap/inbox'): CavageMessage => ({
    method,
    path,
    host: 'ubichill.example',
    header: (name) => headers[name],
});

const mastodonHeader = (headers = '(request-target) host date digest content-type', extra = '') =>
    `keyId="https://mastodon.example/users/bob#main-key",algorithm="rsa-sha256",headers="${headers}",signature="AAEC"${extra}`;

describe('draft-cavage の署名', () => {
    it('署名する文字列は、項目の順に name: value。(request-target) は小文字のメソッドとパス', () => {
        expect(
            cavageSigningString(
                ['(request-target)', 'host', 'date', 'digest'],
                message({ date: DATE, digest: 'SHA-256=abc' }, 'POST', '/ap/inbox?x=1'),
            ),
        ).toBe(`(request-target): post /ap/inbox?x=1\nhost: ubichill.example\ndate: ${DATE}\ndigest: SHA-256=abc`);
    });

    it('項目が欠けている・知らない疑似項目・改行を含む値なら null', () => {
        expect(cavageSigningString(['date'], message({}))).toBeNull();
        expect(cavageSigningString(['(created)'], message({}))).toBeNull();
        expect(cavageSigningString(['date'], message({ date: 'a\nb' }))).toBeNull();
    });

    it('送る側の Signature は、受ける側でそのまま読める', async () => {
        const msg = message({ date: DATE, digest: 'SHA-256=abc', 'content-type': 'application/activity+json' });
        const headers = ['(request-target)', 'host', 'date', 'digest', 'content-type'];
        const signature = await signCavage(msg, headers, 'https://a.example/u#main-key', () => Uint8Array.of(1, 2, 3));
        const read = readCavageSignature(
            message({
                ...{ date: DATE, digest: 'SHA-256=abc' },
                signature,
                'content-type': 'application/activity+json',
            }),
            {
                now: NOW,
            },
        );
        expect(read).toEqual({
            ok: true,
            value: {
                keyId: 'https://a.example/u#main-key',
                signingString: cavageSigningString(headers, msg),
                signature: Uint8Array.of(1, 2, 3),
            },
        });
    });

    it('Signature の形を読む（空白・順番の違いは受け、崩れたものは null）', () => {
        expect(parseCavageSignature(`${mastodonHeader()}`)).toMatchObject({
            keyId: 'https://mastodon.example/users/bob#main-key',
            algorithm: 'rsa-sha256',
            headers: ['(request-target)', 'host', 'date', 'digest', 'content-type'],
        });
        expect(
            parseCavageSignature('signature="AAEC", keyId="k#main-key", headers="(request-target) host date"'),
        ).toMatchObject({ keyId: 'k#main-key', algorithm: null });
        expect(parseCavageSignature('keyId="k"')).toBeNull();
        expect(parseCavageSignature('keyId="k",signature="!!"')).toBeNull();
        expect(parseCavageSignature('keyId="k",signature="AAEC",junk')).toBeNull();
    });

    it('末尾のカンマ・名前の重複（後のものが勝つ）・空の headers は今までどおり読む', () => {
        expect(parseCavageSignature('keyId="a",keyId="b",signature="AAEC",')).toMatchObject({ keyId: 'b' });
        expect(parseCavageSignature('keyId="k",signature="AAEC",headers=""')).toMatchObject({ headers: [] });
        expect(parseCavageSignature('')).toBeNull();
        expect(parseCavageSignature(' keyId="k" , signature="AAEC" ')).toMatchObject({ keyId: 'k' });
    });

    it('未認証の POST で来る長い Signature は、読み直しで時間を食わせずに断る', () => {
        const timed = (header: string) => {
            const start = performance.now();
            const parsed = parseCavageSignature(header);
            return { parsed, ms: performance.now() - start };
        };
        // 英字だけの並び（matchAll なら二次以上に読み直す入力）。上限ちょうどと、Node の既定のヘッダー上限（16KB）まで
        for (const header of [
            'a'.repeat(CAVAGE_MAX_SIGNATURE_CHARS),
            `${'a="",'.repeat(400)}${'a'.repeat(CAVAGE_MAX_SIGNATURE_CHARS - 2001)}`,
            'a'.repeat(16_000),
            `${'a'.repeat(8_000)}=`,
            `${'a="",'.repeat(4_000)}a`,
            ' '.repeat(16_000),
        ]) {
            const { parsed, ms } = timed(header);
            expect(parsed).toBeNull();
            expect(ms).toBeLessThan(50);
        }
    });

    it('正規の Signature（RSA 4096 の署名）は上限の内側で読める。上限を超えたら、中身が正しくても断る', () => {
        // RSA 4096 の署名は 512 バイト（base64 で 684 字）
        const signature = 'AAAA'.repeat(171);
        const long = `keyId="https://mastodon.example/users/bob#main-key",algorithm="rsa-sha256",headers="(request-target) host date digest content-type",signature="${signature}"`;
        expect(long.length).toBeLessThan(CAVAGE_MAX_SIGNATURE_CHARS);
        expect(parseCavageSignature(long)).not.toBeNull();
        const padded = `${long},extra="${'x'.repeat(CAVAGE_MAX_SIGNATURE_CHARS)}"`;
        expect(parseCavageSignature(padded)).toBeNull();
    });

    it('rsa-sha256 と hs2019 だけを受ける', () => {
        const read = (algorithm: string) =>
            readCavageSignature(
                message({
                    date: DATE,
                    digest: 'SHA-256=abc',
                    'content-type': 'x',
                    signature: mastodonHeader().replace('rsa-sha256', algorithm),
                }),
                { now: NOW },
            );
        expect(read('hs2019').ok).toBe(true);
        expect(read('rsa-sha512')).toEqual({ ok: false, reason: 'algorithm' });
        expect(read('hmac-sha256')).toEqual({ ok: false, reason: 'algorithm' });
    });

    it('POST は digest、GET は (request-target)・host・date を署名していなければ断る', () => {
        const post = (headers: string) =>
            readCavageSignature(
                message({ date: DATE, digest: 'SHA-256=abc', 'content-type': 'x', signature: mastodonHeader(headers) }),
                { now: NOW },
            );
        expect(post('(request-target) host date content-type')).toEqual({ ok: false, reason: 'components' });
        expect(post('host date digest')).toEqual({ ok: false, reason: 'components' });
        const get = readCavageSignature(
            message({ date: DATE, accept: 'x', signature: mastodonHeader('(request-target) host date accept') }, 'GET'),
            { now: NOW },
        );
        expect(get.ok).toBe(true);
        // headers が無ければ date だけ（必要な項目が足りない）
        const bare = readCavageSignature(
            message({ date: DATE, signature: 'keyId="k#main-key",signature="AAEC"' }, 'GET'),
            { now: NOW },
        );
        expect(bare).toEqual({ ok: false, reason: 'components' });
    });

    it('Date が無い・読めない・1 時間より前・5 分より先なら断る', () => {
        const at = (date: string | undefined) =>
            readCavageSignature(
                message({
                    ...(date ? { date } : {}),
                    digest: 'SHA-256=abc',
                    'content-type': 'x',
                    signature: mastodonHeader(),
                }),
                { now: NOW },
            );
        expect(at(undefined)).toEqual({ ok: false, reason: 'malformed' });
        expect(at('昨日')).toEqual({ ok: false, reason: 'malformed' });
        expect(at(new Date((NOW - 3601) * 1000).toUTCString())).toEqual({ ok: false, reason: 'expired' });
        expect(at(new Date((NOW + 301) * 1000).toUTCString())).toEqual({ ok: false, reason: 'future' });
        expect(at(new Date((NOW - 3500) * 1000).toUTCString()).ok).toBe(true);
    });

    it('照合は keyId の同じ鍵で行い、無ければ・照合が投げれば false', async () => {
        const read = { keyId: 'k#main-key', signingString: 's', signature: Uint8Array.of(1) };
        const keys = [{ id: 'k#main-key', publicKeyPem: 'PEM' }];
        const calls: string[] = [];
        const crypto = {
            verifyRsaSha256: async (pem: string, data: string) => {
                calls.push(`${pem}:${data}`);
                return true;
            },
        };
        expect(await verifyCavageSignature(read, keys, crypto)).toBe(true);
        expect(await verifyCavageSignature({ ...read, keyId: 'other#main-key' }, keys, crypto)).toBe(false);
        expect(
            await verifyCavageSignature(read, keys, { verifyRsaSha256: async () => Promise.reject(new Error('x')) }),
        ).toBe(false);
        expect(calls).toEqual(['PEM:s']);
    });

    it('Digest は SHA-256 を、ほかのアルゴリズムと並んでいても大文字小文字を問わず読む', () => {
        const sha = Uint8Array.from({ length: 32 }, (_, i) => i);
        expect(readDigestHeader(digestHeader(sha))).toEqual(sha);
        expect(readDigestHeader(`MD5=abc, sha-256=${digestHeader(sha).slice(8)}`)).toEqual(sha);
        expect(readDigestHeader('MD5=abc')).toBeNull();
        expect(readDigestHeader(undefined)).toBeNull();
    });
});
