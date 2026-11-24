import { DEFAULT_SERVER_BRANDING, DEFAULT_SERVER_INFO, type ServerBranding } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import { buildLandingJsonLd, buildLandingTags } from './landing';
import { siteOf } from './site';

const BASE = 'https://ubi.example';
const ICON = {
    favicon: `${BASE}/i/f.png`,
    appleTouchIcon: `${BASE}/i/a.png`,
    icon192: `${BASE}/i/s.png`,
    icon512: `${BASE}/i/l.png`,
};
const site = (info: Partial<typeof DEFAULT_SERVER_INFO> = {}, branding: Partial<ServerBranding> = {}) =>
    siteOf({ info: { ...DEFAULT_SERVER_INFO, ...info }, branding: { ...DEFAULT_SERVER_BRANDING, ...branding } }, BASE);

const jsonLdOf = (tags: string) => {
    const body = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(tags)?.[1];
    return JSON.parse(body ?? 'null') as { '@graph': Array<Record<string, unknown>> };
};

describe('buildLandingTags', () => {
    it('サーバー名・紹介から、タイトル・説明・OGP を作る（URL は絶対 URL）', () => {
        const tags = buildLandingTags(site({ name: 'ようかん', description: '集まる場所' }), true);
        expect(tags).toContain('<title>ようかん</title>');
        expect(tags).toContain('<meta name="description" content="集まる場所">');
        expect(tags).toContain(`<link rel="canonical" href="${BASE}/">`);
        expect(tags).toContain('<meta property="og:site_name" content="ようかん">');
        expect(tags).toContain(`<meta property="og:url" content="${BASE}/">`);
        expect(tags).not.toContain('noindex');
    });

    it('バナーがあれば大きいカード（大きさと形式も書く）', () => {
        const tags = buildLandingTags(site({}, { banner: `${BASE}/b.webp`, icon: ICON }), true);
        expect(tags).toContain(`<meta property="og:image" content="${BASE}/b.webp">`);
        expect(tags).toContain('<meta property="og:image:width" content="1200">');
        expect(tags).toContain('<meta property="og:image:type" content="image/webp">');
        expect(tags).toContain('<meta name="twitter:card" content="summary_large_image">');
    });

    it('バナーが無ければアイコンの小さいカード、どちらも無ければ同梱のアイコン（形式は書かない）', () => {
        const withIcon = buildLandingTags(site({}, { icon: ICON }), true);
        expect(withIcon).toContain(`<meta property="og:image" content="${ICON.icon512}">`);
        expect(withIcon).toContain('<meta name="twitter:card" content="summary">');
        const plain = buildLandingTags(site(), true);
        expect(plain).toContain(`<meta property="og:image" content="${BASE}/icon.png">`);
        expect(plain).not.toContain('og:image:type');
    });

    it('紹介を書いていなければ Ubichill の紹介。長い紹介は 200 文字に縮める', () => {
        expect(buildLandingTags(site(), true)).toContain('同じ空間で、作業も会話もいっしょに。');
        const tags = buildLandingTags(site({ description: `${'あ'.repeat(1999)}\n` }), true);
        const desc = /<meta name="description" content="([^"]*)">/.exec(tags)?.[1] ?? '';
        expect([...desc]).toHaveLength(200);
    });

    it('サーバー名・紹介の <・"・</script> は、属性でも JSON-LD でもエスケープする', () => {
        const evil = '</script><script>alert(1)</script>"><img src=x onerror=alert(2)>';
        const tags = buildLandingTags(site({ name: evil.slice(0, 64), description: evil }), true);
        expect(tags).not.toContain('<script>alert');
        expect(tags).not.toContain('"><img');
        expect(tags.match(/<\/script>/g)).toHaveLength(1);
        const graph = jsonLdOf(tags)['@graph'];
        expect(graph[0]?.name).toBe(evil.slice(0, 64));
    });

    it('本番以外は noindex', () => {
        expect(buildLandingTags(site(), false)).toContain('<meta name="robots" content="noindex, nofollow">');
    });
});

describe('buildLandingJsonLd', () => {
    it('WebSite と Organization を 1 つの @graph に入れ、運営としてつなぐ', () => {
        const graph = (
            JSON.parse(buildLandingJsonLd(site({ name: 'ようかん' }, { shortName: 'ゆ', icon: ICON }))) as {
                '@graph': Array<Record<string, unknown>>;
            }
        )['@graph'];
        expect(graph).toEqual([
            expect.objectContaining({
                '@type': 'WebSite',
                url: `${BASE}/`,
                name: 'ようかん',
                alternateName: 'ゆ',
                publisher: { '@id': `${BASE}/#organization` },
            }),
            expect.objectContaining({ '@type': 'Organization', '@id': `${BASE}/#organization`, logo: ICON.icon512 }),
        ]);
    });

    it('略称がサーバー名と同じ（決めていない）なら alternateName を出さない', () => {
        const graph = (JSON.parse(buildLandingJsonLd(site())) as { '@graph': Array<Record<string, unknown>> })[
            '@graph'
        ];
        expect(graph[0]).not.toHaveProperty('alternateName');
        expect(graph[1]?.logo).toBe(`${BASE}/icon.png`);
    });
});
