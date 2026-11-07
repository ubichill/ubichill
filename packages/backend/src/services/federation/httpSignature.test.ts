import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import {
    contentDigest,
    ed25519Multikey,
    parseDictionary,
    parseEd25519Multikey,
    parseInnerList,
    REQUIRED_COMPONENTS,
    readContentDigest,
    readSignature,
    type SignableMessage,
    sameBytes,
    signatureBase,
    signatureParamsList,
    signMessage,
} from '@ubichill/shared';
import { describe, expect, it } from 'vitest';

// RFC 9421 Appendix B.1.4（test-key-ed25519）
const RFC_PRIVATE = createPrivateKey(
    '-----BEGIN PRIVATE KEY-----\nMC4CAQAwBQYDK2VwBCIEIJ+DYvh6SEqVTm50DFtMDoQikTmiCqirVv9mWG9qfSnF\n-----END PRIVATE KEY-----\n',
);
const RFC_PUBLIC = createPublicKey(
    '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAJrQLj5P/89iXES9+vFgrIy29clF9CC/oPPsw3c5D0bs=\n-----END PUBLIC KEY-----\n',
);

const headersOf =
    (headers: Record<string, string>) =>
    (name: string): string | undefined =>
        headers[name];

// RFC 9421 Appendix B.2 のリクエスト
const rfcRequest: SignableMessage = {
    method: 'POST',
    targetUri: 'https://example.com/foo?param=Value&Pet=dog',
    authority: 'example.com',
    path: '/foo',
    query: '?param=Value&Pet=dog',
    header: headersOf({
        date: 'Tue, 20 Apr 2021 02:07:55 GMT',
        'content-type': 'application/json',
        'content-digest':
            'sha-512=:WZDPaVn/7XgHaAy8pmojAkGWoRx2UFChF41A2svX+TaPm+AbwAgBWnrIiYllu7BNNyealdVLvRwEmTHWXvJwew==:',
        'content-length': '18',
    }),
};

describe('RFC 9421 Appendix B.2.6（ed25519）', () => {
    const list = signatureParamsList(['date', '@method', '@path', '@authority', 'content-type', 'content-length'], {
        created: 1618884473,
        keyid: 'test-key-ed25519',
    });
    const expectedBase = [
        '"date": Tue, 20 Apr 2021 02:07:55 GMT',
        '"@method": POST',
        '"@path": /foo',
        '"@authority": example.com',
        '"content-type": application/json',
        '"content-length": 18',
        '"@signature-params": ("date" "@method" "@path" "@authority" "content-type" "content-length");created=1618884473;keyid="test-key-ed25519"',
    ].join('\n');
    const expectedSignature =
        'wqcAqbmYJ2ji2glfAMaRy4gruYYnx2nEFN2HN6jrnDnQCK1u02Gb04v9EDgwUPiu4A0w6vuQv5lIp5WPpBKRCw==';

    it('署名する文字列が RFC と同じ', () => {
        expect(signatureBase(list, rfcRequest)).toBe(expectedBase);
    });

    it('RFC の鍵で署名すると RFC と同じ署名になる（Ed25519 は決定的）', () => {
        const signature = sign(null, Buffer.from(expectedBase), RFC_PRIVATE).toString('base64');
        expect(signature).toBe(expectedSignature);
        expect(verify(null, Buffer.from(expectedBase), RFC_PUBLIC, Buffer.from(expectedSignature, 'base64'))).toBe(
            true,
        );
    });

    it('RFC の Signature-Input を読み直して書き直すと同じ文字列になる', () => {
        const parsed = parseInnerList(
            '("date" "@method" "@path" "@authority" "content-type" "content-length");created=1618884473;keyid="test-key-ed25519"',
        );
        expect(parsed?.params).toEqual(list.params);
        expect(parsed?.items).toEqual(list.items);
    });
});

describe('RFC 9530 Content-Digest', () => {
    it('{"hello": "world"} と改行の sha-256 が RFC の例と同じ。改行が無ければ別の値（Appendix D）', () => {
        const withLf = createHash('sha256').update('{"hello": "world"}\n').digest();
        expect(contentDigest(withLf)).toBe('sha-256=:RK/0qy18MlBSVnWgjwz6lZEWjP/lF5HF9bvEF8FabDg=:');
        const bare = createHash('sha256').update('{"hello": "world"}').digest();
        expect(contentDigest(bare)).toBe('sha-256=:X48E9qOokqqrvdts8nOJRJN3OWDUoyWxBf7kbu9DBPE=:');
    });

    it('読み直せる。sha-256 が無い・崩れた値は null', () => {
        const digest = createHash('sha256').update('x').digest();
        const read = readContentDigest(contentDigest(digest));
        expect(read && sameBytes(read, digest)).toBe(true);
        expect(readContentDigest('sha-512=:AAAA:')).toBeNull();
        expect(readContentDigest('sha-256=AAAA')).toBeNull();
        expect(readContentDigest(undefined)).toBeNull();
    });
});

/** ubichill のプロファイルで署名した POST を作る（鍵は使い捨て）。 */
async function signedPost(overrides: { created?: number; expires?: number; nonce?: string; body?: string } = {}) {
    const key = createPrivateKey({
        key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.alloc(32, 7)]),
        format: 'der',
        type: 'pkcs8',
    });
    const body = overrides.body ?? '{"type":"Offer"}';
    const headers: Record<string, string> = {
        'content-type': 'application/activity+json',
        'content-digest': contentDigest(createHash('sha256').update(body).digest()),
    };
    const message: SignableMessage = {
        method: 'POST',
        targetUri: 'https://b.example/ap/inbox',
        header: (name) => headers[name],
    };
    const signed = await signMessage(
        message,
        REQUIRED_COMPONENTS.post,
        {
            created: overrides.created ?? 1_762_506_000,
            ...(overrides.expires !== undefined ? { expires: overrides.expires } : {}),
            ...(overrides.nonce !== undefined ? { nonce: overrides.nonce } : {}),
            keyid: 'https://a.example/ap/users/7Fq2aL#ed25519-1',
            alg: 'ed25519',
        },
        (data) => sign(null, data, key),
    );
    Object.assign(headers, signed);
    return { message, headers, publicKey: createPublicKey(key) };
}

const NOW = 1_762_506_000;

describe('readSignature（受け手の確かめ）', () => {
    it('正しい署名を読み、組み立て直した文字列で鍵の検証が通る', async () => {
        const { message, publicKey } = await signedPost();
        const read = readSignature(message, { required: REQUIRED_COMPONENTS.post, now: NOW });
        expect(read.ok).toBe(true);
        if (!read.ok) return;
        expect(read.value.keyid).toBe('https://a.example/ap/users/7Fq2aL#ed25519-1');
        expect(verify(null, read.value.base, publicKey, read.value.signature)).toBe(true);
    });

    it('宛先（@target-uri）が違えば、組み立て直した文字列で検証が通らない（別のサーバーへの転用を防ぐ）', async () => {
        const { headers, publicKey } = await signedPost();
        const elsewhere: SignableMessage = {
            method: 'POST',
            targetUri: 'https://c.example/ap/inbox',
            header: (name) => headers[name],
        };
        const read = readSignature(elsewhere, { required: REQUIRED_COMPONENTS.post, now: NOW });
        expect(read.ok && verify(null, read.value.base, publicKey, read.value.signature)).toBe(false);
    });

    it('本文の要約を差し替えると検証が通らない', async () => {
        const { message, headers, publicKey } = await signedPost();
        headers['content-digest'] = contentDigest(createHash('sha256').update('{"type":"Undo"}').digest());
        const read = readSignature(message, { required: REQUIRED_COMPONENTS.post, now: NOW });
        expect(read.ok && verify(null, read.value.base, publicKey, read.value.signature)).toBe(false);
    });

    it('署名のヘッダーが無ければ missing、崩れていれば malformed', async () => {
        const { headers } = await signedPost();
        const without = (name: string): SignableMessage => ({
            method: 'POST',
            targetUri: 'https://b.example/ap/inbox',
            header: (n) => (n === name ? undefined : headers[n]),
        });
        expect(readSignature(without('signature'), { required: [], now: NOW })).toEqual({
            ok: false,
            reason: 'missing',
        });
        const broken: SignableMessage = {
            method: 'POST',
            targetUri: 'https://b.example/ap/inbox',
            header: (n) => (n === 'signature' ? 'sig1=not-bytes' : headers[n]),
        };
        expect(readSignature(broken, { required: [], now: NOW })).toEqual({ ok: false, reason: 'malformed' });
    });

    it('必要な対象（content-digest など）を署名していなければ components', async () => {
        const { message } = await signedPost();
        expect(readSignature(message, { required: [...REQUIRED_COMPONENTS.post, 'date'], now: NOW })).toEqual({
            ok: false,
            reason: 'components',
        });
    });

    it('created が 5 分より古い・1 分より先・expires 切れ・有効期間が長すぎるなら断る', async () => {
        const old = await signedPost({ created: NOW - 301 });
        expect(readSignature(old.message, { required: [], now: NOW })).toEqual({ ok: false, reason: 'expired' });
        const future = await signedPost({ created: NOW + 61 });
        expect(readSignature(future.message, { required: [], now: NOW })).toEqual({ ok: false, reason: 'future' });
        const expired = await signedPost({ created: NOW - 100, expires: NOW - 31 });
        expect(readSignature(expired.message, { required: [], now: NOW })).toEqual({ ok: false, reason: 'expired' });
        const tooLong = await signedPost({ created: NOW, expires: NOW + 301 });
        expect(readSignature(tooLong.message, { required: [], now: NOW })).toEqual({ ok: false, reason: 'expired' });
        const edge = await signedPost({ created: NOW - 300, expires: NOW - 30 });
        expect(readSignature(edge.message, { required: [], now: NOW }).ok).toBe(true);
    });

    it('nonce が要る RPC では、無い・形の悪い nonce を断る', async () => {
        const plain = await signedPost();
        expect(readSignature(plain.message, { required: [], now: NOW, requireNonce: true })).toEqual({
            ok: false,
            reason: 'nonce',
        });
        const withNonce = await signedPost({ nonce: 'Xk4v0aP3m1pTqJ2w' });
        expect(readSignature(withNonce.message, { required: [], now: NOW, requireNonce: true }).ok).toBe(true);
        const short = await signedPost({ nonce: 'abc' });
        expect(readSignature(short.message, { required: [], now: NOW })).toEqual({ ok: false, reason: 'nonce' });
    });

    it('alg が ed25519 以外なら断る（鍵の種類を取り違えさせない）', async () => {
        const { headers } = await signedPost();
        const swapped: SignableMessage = {
            method: 'POST',
            targetUri: 'https://b.example/ap/inbox',
            header: (n) =>
                n === 'signature-input' ? headers[n]?.replace('alg="ed25519"', 'alg="hmac-sha256"') : headers[n],
        };
        expect(readSignature(swapped, { required: [], now: NOW })).toEqual({ ok: false, reason: 'algorithm' });
    });

    it('ラベルが複数あっても最初の 1 つだけを確かめ、Signature 側に同じラベルが無ければ malformed', async () => {
        const { headers } = await signedPost();
        const other: SignableMessage = {
            method: 'POST',
            targetUri: 'https://b.example/ap/inbox',
            header: (n) => (n === 'signature' ? headers[n]?.replace('sig1=', 'sig2=') : headers[n]),
        };
        expect(readSignature(other, { required: [], now: NOW })).toEqual({ ok: false, reason: 'malformed' });
    });
});

describe('structured fields の境界', () => {
    it('文字列のエスケープ・前後の空白・重複したキー（後の値が勝つ）', () => {
        const dict = parseDictionary(' a="x\\"y", b=?0,  a=1 ');
        expect(dict?.get('a')).toEqual({ kind: 'item', value: { type: 'integer', value: 1 }, params: [] });
        expect([...(dict?.keys() ?? [])]).toEqual(['b', 'a']);
    });

    it('小数・制御文字・閉じていない文字列・末尾のカンマは受けない', () => {
        expect(parseDictionary('a=1.5')).toBeNull();
        expect(parseDictionary('a="x\ny"')).toBeNull();
        expect(parseDictionary('a="x')).toBeNull();
        expect(parseDictionary('a=1,')).toBeNull();
        expect(parseDictionary('A=1')).toBeNull();
    });
});

describe('Multikey', () => {
    it('Ed25519 の公開鍵は z6Mk で始まり、往復できる', () => {
        const raw = Buffer.from(RFC_PUBLIC.export({ format: 'jwk' }).x as string, 'base64url');
        const multikey = ed25519Multikey(raw);
        expect(multikey.startsWith('z6Mk')).toBe(true);
        const back = parseEd25519Multikey(multikey);
        expect(back && Buffer.from(back).equals(raw)).toBe(true);
    });

    it('Ed25519 でない・壊れた値は null', () => {
        expect(parseEd25519Multikey('z6LS')).toBeNull();
        expect(parseEd25519Multikey('u6Mk')).toBeNull();
        expect(parseEd25519Multikey('z0OIl')).toBeNull();
        expect(() => ed25519Multikey(new Uint8Array(31))).toThrow();
    });
});
