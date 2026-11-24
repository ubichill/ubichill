import { DEFAULT_SERVER_BRANDING, DEFAULT_SERVER_INFO } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import { siteOf } from './site';
import { renderWorldShell } from './worldShell';

/**
 * worldShell は SSR で HTML を組み立てる。見た目・文言は目視で確認する方が早いのでテストしない。
 * ここで守るのは「ユーザー文字列を HTML に埋め込む際のエスケープ（XSS）」と
 * 「world 欠損でもクラッシュしない」という不変条件だけ。
 */

const site = siteOf(undefined, 'https://example.com');

const baseWorld = {
    url: 'https://example.com/world/test-world',
    source: { kind: 'local' as const, url: 'https://example.com/world/test-world' },
    version: '1.0.0',
    capacity: { default: 10, max: 20 },
    mods: [],
};

describe('renderWorldShell', () => {
    it('ユーザー文字列を HTML エスケープする（XSS 対策）', () => {
        const html = renderWorldShell({
            site,
            world: {
                id: 'xss-world',
                displayName: '<script>alert(1)</script>',
                description: '" onclick="alert(2)',
                authorName: 'Bob<script>',
                ...baseWorld,
            },
            instances: [],
            publicBaseUrl: 'https://example.com',
            coreApiUrl: 'https://api.example.com',
        });

        expect(html).not.toContain('<script>alert(1)</script>');
        expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
        expect(html).not.toContain('" onclick="alert(2)');
        expect(html).not.toContain('Bob<script>');
    });

    it('world が undefined でもクラッシュせず HTML を返す', () => {
        const html = renderWorldShell({
            site,
            world: undefined,
            instances: [],
            publicBaseUrl: 'https://example.com',
            coreApiUrl: 'https://api.example.com',
        });
        expect(html).toContain('data-world-shell');
    });

    it('見出しはサーバーのアイコンと略称（エスケープする）', () => {
        const branded = siteOf(
            {
                info: { ...DEFAULT_SERVER_INFO, name: 'ようかんの Ubichill' },
                branding: {
                    ...DEFAULT_SERVER_BRANDING,
                    shortName: '<b>ゆ</b>',
                    icon: { favicon: 'f', appleTouchIcon: 'a', icon192: 'https://example.com/s.png', icon512: 'l' },
                },
            },
            'https://example.com',
        );
        const html = renderWorldShell({
            site: branded,
            world: undefined,
            instances: [],
            publicBaseUrl: 'https://example.com',
            coreApiUrl: 'https://api.example.com',
        });
        expect(html).toContain('<img src="https://example.com/s.png"');
        expect(html).toContain('&lt;b&gt;ゆ&lt;/b&gt;');
        expect(html).not.toContain('<b>ゆ</b>');
    });
});
