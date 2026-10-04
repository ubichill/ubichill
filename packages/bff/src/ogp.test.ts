import type { WorldListItem } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import { buildJsonLd, buildMetaTags, buildUserMetaTags } from './ogp';

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
            world: baseWorld,
            worldId: 'w1',
            publicBaseUrl: 'https://e.co',
            enableCrawl: false,
        });
        expect(tags).toContain('noindex, nofollow');
    });

    it('本番はクロールを許可（noindex を付けない）', () => {
        const tags = buildMetaTags({
            world: baseWorld,
            worldId: 'w1',
            publicBaseUrl: 'https://e.co',
            enableCrawl: true,
        });
        expect(tags).not.toContain('noindex');
    });

    it('thumbnail 無しでは og:image を出さない', () => {
        const tags = buildMetaTags({
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
        handle: 'youkan',
        publicBaseUrl: 'https://ubichill.com',
        pageUrl: 'https://ubichill.com/@youkan',
        enableCrawl: true,
    };
    const user = { id: 'u1', name: 'ようかん', handle: 'youkan', profileImageUrl: null, bio: null };

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
            user: { ...user, profileImageUrl: 'https://cdn.example/a.png' },
            worldCount: 0,
        });
        expect(tags).toContain('<meta property="og:image" content="https://cdn.example/a.png">');
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
});
