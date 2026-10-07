import { UbiErrorCode } from '@ubichill/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FetchErrorBody } from './fetchHandler';
import {
    checkUrlAllowed,
    createModFetchHandler,
    fetchDirect,
    isUrlAllowed,
    readBodyWithLimit,
    resolveModAssetUrl,
    resolveModNamespaceUrl,
} from './fetchHandler';

describe('resolveModNamespaceUrl（mod自身の公開名前空間 /mods/<id>/）', () => {
    const origin = 'http://localhost:3000';

    it('自分の公開領域 /mods/<id>/ 配下（api 含む）を許可する', () => {
        expect(resolveModNamespaceUrl('/mods/video-player/api/search?q=x', 'video-player', origin)).toBe(
            'http://localhost:3000/mods/video-player/api/search?q=x',
        );
    });

    it('コアの /api/v1 は名前空間外で null（本体 API 叩きは塞いだまま）', () => {
        expect(resolveModNamespaceUrl('/api/v1/instances', 'video-player', origin)).toBeNull();
    });

    it('他modの名前空間は null（cross-mod 禁止）', () => {
        expect(resolveModNamespaceUrl('/mods/pen/api/steal', 'video-player', origin)).toBeNull();
    });

    it('prefix が同じ別mod (pen-evil) には一致しない', () => {
        expect(resolveModNamespaceUrl('/mods/pen-evil/x', 'pen', origin)).toBeNull();
    });

    it('../ での名前空間脱出は null', () => {
        expect(resolveModNamespaceUrl('/mods/video-player/../../api/v1/x', 'video-player', origin)).toBeNull();
    });

    it('別オリジンの絶対 URL は null', () => {
        expect(
            resolveModNamespaceUrl('https://evil.example.com/mods/video-player/api', 'video-player', origin),
        ).toBeNull();
    });

    it('modId / appOrigin 未指定は null', () => {
        expect(resolveModNamespaceUrl('/mods/x/api', undefined, origin)).toBeNull();
        expect(resolveModNamespaceUrl('/mods/x/api', 'x', undefined)).toBeNull();
    });
});

describe('resolveModAssetUrl（modアセット領域への限定）', () => {
    const base = 'https://cdn.example.com/mods/pen/v2';

    it('相対 URL を modBase 配下に解決する', () => {
        expect(resolveModAssetUrl('./stroke.json', base)).toBe('https://cdn.example.com/mods/pen/v2/stroke.json');
        expect(resolveModAssetUrl('data/x.png', base)).toBe('https://cdn.example.com/mods/pen/v2/data/x.png');
    });

    it('ホスト内部 API を狙う先頭スラッシュ URL は領域外として null（抜け道を塞ぐ）', () => {
        expect(resolveModAssetUrl('/api/v1/instances', base)).toBeNull();
    });

    it('ディレクトリトラバーサルで base を抜ける URL は null', () => {
        expect(resolveModAssetUrl('../../secret', base)).toBeNull();
        expect(resolveModAssetUrl('../other-mod/x', base)).toBeNull();
    });

    it('別 origin の絶対 URL は null（外部として allowlist 検査に回す）', () => {
        expect(resolveModAssetUrl('https://api.github.com/x', base)).toBeNull();
    });

    it('modBase と同一 origin でも領域外パスは null', () => {
        expect(resolveModAssetUrl('https://cdn.example.com/api/x', base)).toBeNull();
    });

    it('modBase が未指定なら常に null', () => {
        expect(resolveModAssetUrl('./x.json', undefined)).toBeNull();
        expect(resolveModAssetUrl('./x.json', '')).toBeNull();
    });

    it('modが同一 origin ホストから配信されていても /api は領域外で null', () => {
        // 例: dev で mods が host と同一 origin に置かれるケース
        const localBase = 'http://localhost:5173/mods/pen/v2';
        expect(resolveModAssetUrl('/api/v1/instances', localBase)).toBeNull();
        expect(resolveModAssetUrl('./asset.js', localBase)).toBe('http://localhost:5173/mods/pen/v2/asset.js');
    });
});

describe('checkUrlAllowed', () => {
    const domains = ['api.github.com'];

    it('許可ドメインの https URL を通す', () => {
        expect(checkUrlAllowed('https://api.github.com/repos', domains)).toEqual({ allowed: true });
    });

    it('サブドメインも suffix マッチで通す', () => {
        expect(checkUrlAllowed('https://raw.api.github.com/x', domains).allowed).toBe(true);
    });

    it('http は拒否する（HTTPS 必須）', () => {
        const r = checkUrlAllowed('http://api.github.com', domains);
        expect(r).toMatchObject({ allowed: false, code: UbiErrorCode.FETCH_HTTPS_REQUIRED });
    });

    it('未許可ドメインを拒否する', () => {
        const r = checkUrlAllowed('https://evil.example.com', domains);
        expect(r).toMatchObject({ allowed: false, code: UbiErrorCode.FETCH_DOMAIN_NOT_ALLOWED });
    });

    it('部分一致のなりすまし（github.com.evil.com）を拒否する', () => {
        expect(isUrlAllowed('https://api.github.com.evil.com', domains)).toBe(false);
    });

    it('不正な URL を拒否する', () => {
        const r = checkUrlAllowed('not a url', domains);
        expect(r).toMatchObject({ allowed: false, code: UbiErrorCode.FETCH_INVALID_URL });
    });

    it('空の allowlist では全ドメインを拒否する', () => {
        expect(isUrlAllowed('https://api.github.com', [])).toBe(false);
    });
});

describe('createModFetchHandler', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('未許可ドメインは fetch を呼ばず 403 を返す', async () => {
        const spy = vi.spyOn(globalThis, 'fetch');
        const handler = createModFetchHandler(['api.github.com']);
        const res = await handler('https://evil.example.com/steal');

        expect(spy).not.toHaveBeenCalled();
        expect(res.ok).toBe(false);
        expect(res.status).toBe(403);
        const body = JSON.parse(res.body as string) as FetchErrorBody;
        expect(body.error.code).toBe(UbiErrorCode.FETCH_DOMAIN_NOT_ALLOWED);
        // 拒否時は許可ドメイン一覧を返し、mod側が理由を判別できる
        expect(body.error.allowedDomains).toEqual(['api.github.com']);
    });

    it('許可ドメインは実 fetch を実行して結果を返す', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('hello', { status: 200, statusText: 'OK' }));
        const handler = createModFetchHandler(['api.github.com']);
        const res = await handler('https://api.github.com/ok');

        expect(res.ok).toBe(true);
        expect(res.status).toBe(200);
        expect(res.body).toBe('hello');
    });
});

function streamOf(chunks: Uint8Array[], onCancel?: () => void): ReadableStream<Uint8Array> {
    const queue = [...chunks];
    return new ReadableStream({
        pull(controller) {
            const next = queue.shift();
            if (next) controller.enqueue(next);
            else controller.close();
        },
        cancel: onCancel,
    });
}

describe('readBodyWithLimit', () => {
    it('分割された本文を 1 つの ArrayBuffer に連結する', async () => {
        const res = new Response(streamOf([new Uint8Array([1, 2]), new Uint8Array([3]), new Uint8Array([4, 5])]));
        const body = await readBodyWithLimit(res, 5);
        expect(new Uint8Array(body as ArrayBuffer)).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
    });

    it('content-length を偽って小さく申告しても、実際に読んだ量で止める', async () => {
        const cancel = vi.fn();
        const res = new Response(streamOf([new Uint8Array(4), new Uint8Array(4), new Uint8Array(4)], cancel), {
            headers: { 'content-length': '1' },
        });
        expect(await readBodyWithLimit(res, 6)).toBe('too-large');
        expect(cancel).toHaveBeenCalled();
    });

    it('content-length が上限を超えていれば本文を読まずに止める', async () => {
        const cancel = vi.fn();
        const res = new Response(streamOf([new Uint8Array(1)], cancel), { headers: { 'content-length': '100' } });
        expect(await readBodyWithLimit(res, 10)).toBe('too-large');
        expect(cancel).toHaveBeenCalled();
    });

    it('本文が無い応答は空の ArrayBuffer', async () => {
        expect((await readBodyWithLimit(new Response(null, { status: 204 }), 0)) as ArrayBuffer).toHaveProperty(
            'byteLength',
            0,
        );
    });
});

describe('fetchDirect（バイナリ・制限・取り消し）', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("responseType: 'arrayBuffer' はバイト列をそのまま返し、UTF-8 として壊さない", async () => {
        const bytes = new Uint8Array([0x00, 0xff, 0xfe, 0x80, 0x0a]);
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(bytes, { status: 200 }));
        const res = await fetchDirect('https://cdn.example.com/a.wasm', { responseType: 'arrayBuffer' });
        expect(new Uint8Array(res.body as ArrayBuffer)).toEqual(bytes);
    });

    it('既定（text）は従来どおり文字列を返し、最終 URL も返す', async () => {
        const response = new Response('ok', { status: 200 });
        Object.defineProperty(response, 'url', { value: 'https://api.example.com/final' });
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(response);
        const res = await fetchDirect('https://api.example.com/start');
        expect(res).toMatchObject({ ok: true, body: 'ok', url: 'https://api.example.com/final' });
        expect(res.error).toBeUndefined();
    });

    it('上限を超えた本文は 413 と FETCH_RESPONSE_TOO_LARGE になり、本文を渡さない', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new Uint8Array(32)));
        const res = await fetchDirect('https://cdn.example.com/big', { responseType: 'arrayBuffer', maxBytes: 16 });
        expect(res).toMatchObject({ ok: false, status: 413, error: { code: UbiErrorCode.FETCH_RESPONSE_TOO_LARGE } });
        expect((res.body as ArrayBuffer).byteLength).toBe(0);
    });

    it('取り消し済みの signal では通信しない', async () => {
        const spy = vi.spyOn(globalThis, 'fetch');
        const controller = new AbortController();
        controller.abort();
        const res = await fetchDirect('https://api.example.com/x', undefined, { signal: controller.signal });
        expect(spy).not.toHaveBeenCalled();
        expect(res.error?.code).toBe(UbiErrorCode.FETCH_ABORTED);
    });

    it('通信中に timeoutMs を過ぎたら FETCH_TIMEOUT', async () => {
        vi.spyOn(globalThis, 'fetch').mockImplementation(
            (_url, init) =>
                new Promise((_resolve, reject) => {
                    init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
                }),
        );
        const res = await fetchDirect('https://api.example.com/slow', { timeoutMs: 10 });
        expect(res).toMatchObject({ status: 504, error: { code: UbiErrorCode.FETCH_TIMEOUT } });
    });

    it('cookie の扱い（credentials）とバイナリの送信本文を fetch に渡す', async () => {
        const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(''));
        const body = new Uint8Array([1, 2, 3]);
        await fetchDirect('https://api.example.com/upload', { method: 'POST', body }, { credentials: 'omit' });
        expect(spy).toHaveBeenCalledWith(
            'https://api.example.com/upload',
            expect.objectContaining({ method: 'POST', body, credentials: 'omit' }),
        );
    });

    it('通信の失敗は FETCH_NETWORK_ERROR（例外を mod に漏らさない）', async () => {
        vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const res = await fetchDirect('https://api.example.com/x', { responseType: 'arrayBuffer' });
        expect(res).toMatchObject({ ok: false, error: { code: UbiErrorCode.FETCH_NETWORK_ERROR } });
        expect(res.body).toBeInstanceOf(ArrayBuffer);
    });

    it('リダイレクトは追わずに FETCH_REDIRECT_BLOCKED で返し、本文を渡さない', async () => {
        const spy = vi
            .spyOn(globalThis, 'fetch')
            .mockResolvedValue(
                new Response('secret', { status: 307, headers: { location: 'https://evil.example/x' } }),
            );
        const res = await fetchDirect('https://api.example.com/r', { method: 'POST', body: 'payload' });

        expect(spy).toHaveBeenCalledWith('https://api.example.com/r', expect.objectContaining({ redirect: 'manual' }));
        expect(res).toMatchObject({ ok: false, status: 403, error: { code: UbiErrorCode.FETCH_REDIRECT_BLOCKED } });
        expect(String(res.body)).not.toContain('secret');
    });

    it('ブラウザの opaqueredirect（行き先が見えない応答）も同じく拒否する', async () => {
        const opaque = new Response(null, { status: 200 });
        Object.defineProperty(opaque, 'type', { value: 'opaqueredirect' });
        Object.defineProperty(opaque, 'status', { value: 0 });
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(opaque);
        const res = await fetchDirect('https://api.example.com/r', { responseType: 'arrayBuffer' });
        expect(res.error?.code).toBe(UbiErrorCode.FETCH_REDIRECT_BLOCKED);
        expect(res.body).toBeInstanceOf(ArrayBuffer);
    });

    it('304 Not Modified はリダイレクトではないのでそのまま返す', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 304 }));
        const res = await fetchDirect('https://api.example.com/r', { headers: { 'if-none-match': '"v1"' } });
        expect(res.status).toBe(304);
        expect(res.error).toBeUndefined();
    });
});
