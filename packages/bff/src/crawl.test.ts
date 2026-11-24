import type { WorldListItem } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import {
    buildRobotsTxt,
    buildSitemap,
    crawlEnabledFor,
    isUserPageIndexable,
    isWorldIndexable,
    SITEMAP_MAX_URLS,
    sitemapEntries,
} from './crawl';

const BASE = 'https://ubi.example';

const world = (name: string, patch: Partial<WorldListItem> = {}): WorldListItem => ({
    id: name,
    url: `${BASE}/api/v1/authors/aya/worlds/${name}.yaml`,
    source: { kind: 'local', url: `${BASE}/api/v1/authors/aya/worlds/${name}.yaml` },
    displayName: name,
    version: '1.0.0',
    capacity: { default: 4, max: 8 },
    mods: [],
    ...patch,
});

describe('crawlEnabledFor', () => {
    it('配備の環境が production のときだけ載せる（BFF の NODE_ENV は見ない）', () => {
        expect(crawlEnabledFor({ DEPLOYMENT_ENVIRONMENT: 'production', NODE_ENV: 'production' })).toBe(true);
        // dev・プレビュー: backend は development、BFF のイメージは NODE_ENV=production
        expect(crawlEnabledFor({ DEPLOYMENT_ENVIRONMENT: 'development', NODE_ENV: 'production' })).toBe(false);
        expect(crawlEnabledFor({ DEPLOYMENT_ENVIRONMENT: 'test', NODE_ENV: 'production' })).toBe(false);
        expect(crawlEnabledFor({ DEPLOYMENT_ENVIRONMENT: 'production', NODE_ENV: 'development' })).toBe(true);
    });

    it('渡されていない（空も）ときは BFF の NODE_ENV に従う', () => {
        expect(crawlEnabledFor({ NODE_ENV: 'production' })).toBe(true);
        expect(crawlEnabledFor({ DEPLOYMENT_ENVIRONMENT: ' ', NODE_ENV: 'production' })).toBe(true);
        expect(crawlEnabledFor({ NODE_ENV: 'development' })).toBe(false);
        expect(crawlEnabledFor({})).toBe(false);
    });
});

describe('isUserPageIndexable', () => {
    it('「おすすめや検索に出す」をオフにした人・見つからない人は載せない', () => {
        expect(isUserPageIndexable({ discoverable: true })).toBe(true);
        // 古い backend の応答（項目が無い）は前と同じく載せる
        expect(isUserPageIndexable({})).toBe(true);
        expect(isUserPageIndexable({ discoverable: false })).toBe(false);
        expect(isUserPageIndexable(undefined)).toBe(false);
    });
});

describe('isWorldIndexable', () => {
    it('このサーバーのパブリックなワールドだけ', () => {
        expect(isWorldIndexable(world('a'))).toBe(true);
        expect(isWorldIndexable(world('a', { visibility: 'public' }))).toBe(true);
        expect(isWorldIndexable(world('a', { visibility: 'private' }))).toBe(false);
        expect(isWorldIndexable(world('a', { source: { kind: 'url', url: 'https://x.example/w.yaml' } }))).toBe(false);
        expect(
            isWorldIndexable(world('a', { source: { kind: 'remote-instance', url: 'https://peer.example/w.yaml' } })),
        ).toBe(false);
        expect(isWorldIndexable(undefined)).toBe(false);
    });
});

describe('buildRobotsTxt', () => {
    it('本番以外はすべて断る（sitemap も知らせない）', () => {
        expect(buildRobotsTxt({ enableCrawl: false, publicBaseUrl: BASE })).toBe('User-agent: *\nDisallow: /\n');
    });

    it('本番は API を断るが、OGP の画像は読ませ、sitemap を知らせる', () => {
        const robots = buildRobotsTxt({ enableCrawl: true, publicBaseUrl: BASE });
        expect(robots).toContain('Disallow: /api/\n');
        expect(robots).toContain('Allow: /api/v1/server/images/\n');
        expect(robots).toContain('Allow: /api/v1/users/*/images/\n');
        expect(robots).toContain('Disallow: /instance/\n');
        expect(robots).toContain(`Sitemap: ${BASE}/sitemap.xml\n`);
        expect(robots).not.toMatch(/^Disallow: \/$/m);
    });
});

describe('sitemapEntries', () => {
    it('紹介のページ・パブリックなワールド・検索に出してよい人を載せる。プライベート・外部のワールドは載せない', () => {
        const entries = sitemapEntries({
            publicBaseUrl: BASE,
            worlds: [
                world('cafe', { updatedAt: '2026-11-20T10:00:00.000Z' }),
                world('secret', { visibility: 'private' }),
                world('ext', { source: { kind: 'url', url: 'https://x.example/w.yaml' } }),
                // 共有ページの無い（以前の ID の URL の）ワールド
                world('old', { url: `${BASE}/api/v1/worlds/old` }),
            ],
            users: [{ handle: 'aya' }],
        });
        expect(entries).toEqual([
            { loc: `${BASE}/` },
            { loc: `${BASE}/@aya/cafe`, lastmod: '2026-11-20T10:00:00.000Z' },
            // 人のページはアカウントを変えた時刻を出さない
            { loc: `${BASE}/@aya` },
        ]);
    });

    it('ID の形でない人・読めない日付は使わず、同じ URL は 1 回だけ', () => {
        const entries = sitemapEntries({
            publicBaseUrl: BASE,
            worlds: [world('a', { updatedAt: 'yesterday' }), world('a')],
            users: [{ handle: '../admin' }, { handle: 'AYA' }, { handle: 'aya' }, { handle: 'aya' }],
        });
        expect(entries).toEqual([{ loc: `${BASE}/` }, { loc: `${BASE}/@aya/a` }, { loc: `${BASE}/@aya` }]);
    });

    it('上限の数を超えない', () => {
        const users = Array.from({ length: SITEMAP_MAX_URLS + 10 }, (_, i) => ({
            handle: `u${String(i).padStart(6, '0')}`,
        }));
        expect(sitemapEntries({ publicBaseUrl: BASE, worlds: [], users })).toHaveLength(SITEMAP_MAX_URLS);
    });
});

describe('buildSitemap', () => {
    it('URL の & などを XML でエスケープする', () => {
        const xml = buildSitemap([{ loc: `${BASE}/world?url=a&b=<c>` }]);
        expect(xml).toContain('<loc>https://ubi.example/world?url=a&amp;b=&lt;c&gt;</loc>');
        expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<urlset')).toBe(true);
    });
});
