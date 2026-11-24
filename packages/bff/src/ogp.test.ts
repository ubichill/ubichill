import { DEFAULT_SERVER_BRANDING, DEFAULT_SERVER_INFO, type WorldListItem } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import { buildJsonLd, buildMetaTags, buildUserMetaTags } from './ogp';
import { siteOf } from './site';

const SITE = siteOf(undefined, 'https://ubichill.com');
const ICON = {
    favicon: 'https://ubichill.com/api/v1/server/images/favicon/f.png',
    appleTouchIcon: 'https://ubichill.com/api/v1/server/images/apple-touch-icon/a.png',
    icon192: 'https://ubichill.com/api/v1/server/images/icon-192/s.png',
    icon512: 'https://ubichill.com/api/v1/server/images/icon-512/l.png',
};

const baseWorld: WorldListItem = {
    id: 'w1',
    url: 'https://example.com/api/v1/worlds/w1',
    source: { kind: 'local', url: 'https://example.com/api/v1/worlds/w1' },
    displayName: 'サンプル',
    version: '1.0.0',
    capacity: { default: 10, max: 20 },
    mods: [],
    authorName: 'Alice',
};

describe('buildJsonLd', () => {
    it('displayName の </script> ブレイクアウトを塞ぐ', () => {
        const world = { ...baseWorld, displayName: '</script><script>alert(1)</script>' };
        const out = buildJsonLd(world, world.displayName, 'd', 'https://example.com/world/w1');
        expect(out).not.toContain('</script>');
        expect(out).not.toContain('<script>');
        expect(JSON.parse(out).name).toBe('</script><script>alert(1)</script>');
    });
});

describe('buildMetaTags', () => {
    it('ユーザー文字列を属性コンテキストでエスケープする', () => {
        const world = { ...baseWorld, displayName: '"><img src=x onerror=alert(1)>' };
        const tags = buildMetaTags({
            site: SITE,
            world,
            worldId: 'w1',
            publicBaseUrl: 'https://example.com',
            enableCrawl: true,
        });
        // 生の break-out 文字列は残らない
        expect(tags).not.toContain('"><img src=x');
        expect(tags).toContain('&quot;&gt;&lt;img');
    });

    it('本番以外は noindex を付与する', () => {
        const tags = buildMetaTags({
            site: SITE,
            world: baseWorld,
            worldId: 'w1',
            publicBaseUrl: 'https://e.co',
            enableCrawl: false,
        });
        expect(tags).toContain('noindex, nofollow');
    });

    it('本番はクロールを許可（noindex を付けない）', () => {
        const tags = buildMetaTags({
            site: SITE,
            world: baseWorld,
            worldId: 'w1',
            publicBaseUrl: 'https://e.co',
            enableCrawl: true,
        });
        expect(tags).not.toContain('noindex');
    });

    it('thumbnail 無しでは og:image を出さない', () => {
        const tags = buildMetaTags({
            site: SITE,
            world: baseWorld,
            worldId: 'w1',
            publicBaseUrl: 'https://e.co',
            enableCrawl: true,
        });
        expect(tags).not.toContain('og:image');
        expect(tags).toContain('content="summary"');
    });

    it('外部ワールド共有URLをcanonicalとog:urlに使用する', () => {
        const pageUrl =
            'https://ubichill.example/world?url=https%3A%2F%2Fraw.githubusercontent.com%2Fo%2Fr%2Fmain%2Fw.yaml';
        const tags = buildMetaTags({
            site: SITE,
            world: baseWorld,
            worldId: 'w1',
            publicBaseUrl: 'https://ubichill.example',
            pageUrl,
            enableCrawl: true,
        });
        expect(tags).toContain(`<link rel="canonical" href="${pageUrl}">`);
        expect(tags).toContain(`<meta property="og:url" content="${pageUrl}">`);
    });
});

describe('buildUserMetaTags', () => {
    const base = {
        site: SITE,
        handle: 'youkan',
        publicBaseUrl: 'https://ubichill.com',
        pageUrl: 'https://ubichill.com/@youkan',
        enableCrawl: true,
    };
    const user = { id: 'u1', name: 'ようかん', handle: 'youkan', image: null, bio: null };

    it('名前・作者アカウント・公開しているワールドの数で説明を作り、アイコンが無ければサイトのアイコン', () => {
        const tags = buildUserMetaTags({ ...base, user, worldCount: 3 });
        expect(tags).toContain('<meta property="og:title" content="ようかん（@youkan@ubichill.com）">');
        expect(tags).toContain('公開しているワールド 3 件');
        expect(tags).toContain('<meta property="og:image" content="https://ubichill.com/icon.png">');
        expect(tags).toContain('<meta property="og:type" content="profile">');
        expect(tags).toContain('<link rel="canonical" href="https://ubichill.com/@youkan">');
    });

    it('自己紹介を書いていれば、それを説明にする（改行は空白にまとめる）', () => {
        const tags = buildUserMetaTags({
            ...base,
            user: { ...user, bio: 'ワールドを作っています。\nよろしく' },
            worldCount: 3,
        });
        expect(tags).toContain('<meta property="og:description" content="ワールドを作っています。 よろしく">');
        expect(tags).not.toContain('公開しているワールド');
    });

    it('アイコンがあればそれを使う', () => {
        const tags = buildUserMetaTags({
            ...base,
            user: { ...user, image: 'https://cdn.example/a.png' },
            worldCount: 0,
        });
        expect(tags).toContain('<meta property="og:image" content="https://cdn.example/a.png">');
    });

    it('自己紹介が無ければ、ひとことを説明にする', () => {
        const tags = buildUserMetaTags({ ...base, user: { ...user, status: '作業中' }, worldCount: 3 });
        expect(tags).toContain('<meta property="og:description" content="作業中">');
        const both = buildUserMetaTags({
            ...base,
            user: { ...user, bio: '自己紹介', status: '作業中' },
            worldCount: 3,
        });
        expect(both).toContain('<meta property="og:description" content="自己紹介">');
    });

    it('アップロードしたアイコンを小さいカードで出す（バナーがあってもアイコンを優先）', () => {
        const tags = buildUserMetaTags({
            ...base,
            user: {
                ...user,
                image: 'https://ubichill.com/api/v1/users/u1/images/avatar/abc.webp',
                bannerImage: 'https://ubichill.com/api/v1/users/u1/images/banner/def.webp',
            },
            worldCount: 0,
        });
        expect(tags).toContain(
            '<meta property="og:image" content="https://ubichill.com/api/v1/users/u1/images/avatar/abc.webp">',
        );
        expect(tags).toContain('<meta name="twitter:card" content="summary">');
    });

    it('アイコンが無くバナーがあれば、バナーを大きいカードで出す', () => {
        const banner = 'https://ubichill.com/api/v1/users/u1/images/banner/def.webp';
        const tags = buildUserMetaTags({ ...base, user: { ...user, bannerImage: banner }, worldCount: 0 });
        expect(tags).toContain(`<meta property="og:image" content="${banner}">`);
        expect(tags).toContain('<meta name="twitter:card" content="summary_large_image">');
    });

    it('プロフィールの項目が無い（古い backend の）応答でも作れる', () => {
        const tags = buildUserMetaTags({ ...base, user, worldCount: 1 });
        expect(tags).toContain('<meta name="twitter:card" content="summary">');
    });

    it('見つからないユーザーは ID だけを出す（ワールドの数は出さない）', () => {
        const tags = buildUserMetaTags({ ...base, user: undefined, worldCount: undefined });
        expect(tags).toContain('<meta property="og:title" content="@youkan@ubichill.com">');
        expect(tags).not.toContain('公開しているワールド');
    });

    it('表示名の HTML と </script> をエスケープする', () => {
        const evil = { ...user, name: '"><script>alert(1)</script>' };
        const tags = buildUserMetaTags({ ...base, user: evil, worldCount: 1 });
        expect(tags).not.toContain('"><script>');
        expect(tags.split('<script type="application/ld+json">')[1]).not.toMatch(/<\/script>.*<\/script>/s);
    });

    it('サーバーのアイコンを決めていれば、画像の無い人にはそれを出す', () => {
        const site = siteOf(
            {
                info: { ...DEFAULT_SERVER_INFO, name: 'ようかんの Ubichill' },
                branding: { ...DEFAULT_SERVER_BRANDING, shortName: 'ようかん', icon: ICON },
            },
            'https://ubichill.com',
        );
        const tags = buildUserMetaTags({ ...base, site, user, worldCount: 0 });
        expect(tags).toContain(`<meta property="og:image" content="${ICON.icon512}">`);
        expect(tags).toContain('<title>ようかん（@youkan@ubichill.com） — ようかん</title>');
        expect(tags).toContain('<meta property="og:site_name" content="ようかんの Ubichill">');
    });
});

describe('サーバーの名前（ワールドのページ）', () => {
    it('タイトルの後ろは略称、og:site_name はサーバー名。どちらもエスケープする', () => {
        const site = siteOf(
            {
                info: { ...DEFAULT_SERVER_INFO, name: '<b>"Ubi"</b>' },
                branding: { ...DEFAULT_SERVER_BRANDING, shortName: '</title><script>' },
            },
            'https://e.co',
        );
        const tags = buildMetaTags({
            site,
            world: baseWorld,
            worldId: 'w1',
            publicBaseUrl: 'https://e.co',
            enableCrawl: true,
        });
        expect(tags).toContain('<title>サンプル — &lt;/title&gt;&lt;script&gt;</title>');
        expect(tags).toContain('<meta property="og:site_name" content="&lt;b&gt;&quot;Ubi&quot;&lt;/b&gt;">');
    });
});
