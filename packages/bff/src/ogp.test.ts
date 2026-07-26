import type { WorldListItem } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import { buildJsonLd, buildMetaTags } from './ogp';

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
});
