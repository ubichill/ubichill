import { DEFAULT_SERVER_BRANDING, DEFAULT_SERVER_INFO, type ServerIconUrls } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import { plainPageTags, siteHeadTags } from './head';
import { siteOf } from './site';

const BASE = 'https://ubi.example';
const ICON: ServerIconUrls = {
    favicon: `${BASE}/api/v1/server/images/favicon/f.png`,
    appleTouchIcon: `${BASE}/api/v1/server/images/apple-touch-icon/a.png`,
    icon192: `${BASE}/api/v1/server/images/icon-192/s.png`,
    icon512: `${BASE}/api/v1/server/images/icon-512/l.png`,
};

describe('siteHeadTags', () => {
    it('アイコンを決めていなければ同梱のアイコン、色は既定のまま（style を入れない）', () => {
        const tags = siteHeadTags(siteOf(undefined, BASE));
        expect(tags).toContain(`<link rel="icon" href="${BASE}/icon.png">`);
        expect(tags).toContain(`<link rel="apple-touch-icon" href="${BASE}/icon.png">`);
        expect(tags).toContain('<link rel="manifest" href="/manifest.webmanifest">');
        expect(tags).not.toContain('<style');
    });

    it('決めたアイコン（タブは 32px の PNG、iOS は塗った PNG）と色を入れる', () => {
        const site = siteOf(
            { info: DEFAULT_SERVER_INFO, branding: { ...DEFAULT_SERVER_BRANDING, icon: ICON, themeColor: '#2f6f4f' } },
            BASE,
        );
        const tags = siteHeadTags(site);
        expect(tags).toContain(`<link rel="icon" type="image/png" sizes="32x32" href="${ICON.favicon}">`);
        expect(tags).toContain(`<link rel="icon" type="image/png" sizes="192x192" href="${ICON.icon192}">`);
        expect(tags).toContain(`<link rel="apple-touch-icon" href="${ICON.appleTouchIcon}">`);
        expect(tags).toMatch(/<style id="ubichill-theme">:root\{--colors-primary:#2f6f4f;[^<]*\}<\/style>/);
    });

    it('略称の HTML はエスケープする', () => {
        const site = siteOf(
            {
                info: DEFAULT_SERVER_INFO,
                branding: { ...DEFAULT_SERVER_BRANDING, shortName: '"><script>alert(1)</script>' },
            },
            BASE,
        );
        const tags = siteHeadTags(site);
        expect(tags).not.toContain('<script>');
        expect(tags).toContain('content="&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;"');
    });
});

describe('plainPageTags', () => {
    it('サーバー名をタイトル、紹介を説明にし、本番以外は noindex', () => {
        const site = siteOf({ info: { ...DEFAULT_SERVER_INFO, name: 'A & B', description: '紹介\n二行目' } }, BASE);
        expect(plainPageTags(site, true)).toBe(
            '<title>A &amp; B</title>\n<meta name="description" content="紹介 二行目">',
        );
        expect(plainPageTags(site, false)).toContain('<meta name="robots" content="noindex, nofollow">');
    });
});
