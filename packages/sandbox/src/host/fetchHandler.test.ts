import { UbiErrorCode } from '@ubichill/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FetchErrorBody } from './fetchHandler';
import { checkUrlAllowed, createPluginFetchHandler, isUrlAllowed, resolvePluginAssetUrl } from './fetchHandler';

describe('resolvePluginAssetUrl（プラグインアセット領域への限定）', () => {
    const base = 'https://cdn.example.com/plugins/pen/v2';

    it('相対 URL を pluginBase 配下に解決する', () => {
        expect(resolvePluginAssetUrl('./stroke.json', base)).toBe('https://cdn.example.com/plugins/pen/v2/stroke.json');
        expect(resolvePluginAssetUrl('data/x.png', base)).toBe('https://cdn.example.com/plugins/pen/v2/data/x.png');
    });

    it('ホスト内部 API を狙う先頭スラッシュ URL は領域外として null（抜け道を塞ぐ）', () => {
        expect(resolvePluginAssetUrl('/api/v1/instances', base)).toBeNull();
    });

    it('ディレクトリトラバーサルで base を抜ける URL は null', () => {
        expect(resolvePluginAssetUrl('../../secret', base)).toBeNull();
        expect(resolvePluginAssetUrl('../other-plugin/x', base)).toBeNull();
    });

    it('別 origin の絶対 URL は null（外部として allowlist 検査に回す）', () => {
        expect(resolvePluginAssetUrl('https://api.github.com/x', base)).toBeNull();
    });

    it('pluginBase と同一 origin でも領域外パスは null', () => {
        expect(resolvePluginAssetUrl('https://cdn.example.com/api/x', base)).toBeNull();
    });

    it('pluginBase が未指定なら常に null', () => {
        expect(resolvePluginAssetUrl('./x.json', undefined)).toBeNull();
        expect(resolvePluginAssetUrl('./x.json', '')).toBeNull();
    });

    it('プラグインが同一 origin ホストから配信されていても /api は領域外で null', () => {
        // 例: dev で plugins が host と同一 origin に置かれるケース
        const localBase = 'http://localhost:5173/plugins/pen/v2';
        expect(resolvePluginAssetUrl('/api/v1/instances', localBase)).toBeNull();
        expect(resolvePluginAssetUrl('./asset.js', localBase)).toBe('http://localhost:5173/plugins/pen/v2/asset.js');
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

describe('createPluginFetchHandler', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('未許可ドメインは fetch を呼ばず 403 を返す', async () => {
        const spy = vi.spyOn(globalThis, 'fetch');
        const handler = createPluginFetchHandler(['api.github.com']);
        const res = await handler('https://evil.example.com/steal');

        expect(spy).not.toHaveBeenCalled();
        expect(res.ok).toBe(false);
        expect(res.status).toBe(403);
        const body = JSON.parse(res.body) as FetchErrorBody;
        expect(body.error.code).toBe(UbiErrorCode.FETCH_DOMAIN_NOT_ALLOWED);
        // 拒否時は許可ドメイン一覧を返し、プラグイン側が理由を判別できる
        expect(body.error.allowedDomains).toEqual(['api.github.com']);
    });

    it('許可ドメインは実 fetch を実行して結果を返す', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('hello', { status: 200, statusText: 'OK' }));
        const handler = createPluginFetchHandler(['api.github.com']);
        const res = await handler('https://api.github.com/ok');

        expect(res.ok).toBe(true);
        expect(res.status).toBe(200);
        expect(res.body).toBe('hello');
    });
});
