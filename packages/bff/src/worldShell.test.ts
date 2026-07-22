import { describe, expect, it } from 'vitest';
import { renderWorldShell } from './worldShell';

const baseWorld = {
    url: 'https://example.com/world/test-world',
    source: { kind: 'local' as const, url: 'https://example.com/world/test-world' },
    version: '1.0.0',
    capacity: { default: 10, max: 20 },
};

const baseInstance = {
    id: 'i1',
    status: 'active' as const,
    leaderId: 'u1',
    createdAt: '2024-01-01T00:00:00Z',
    expiresAt: null,
    world: { id: 'instance-world', version: '1.0.0', displayName: 'インスタンスあり', authorId: 'u1' },
    access: { type: 'public' as const, tags: [], password: false },
    stats: { currentUsers: 3, maxUsers: 10 },
    connection: { url: 'default', namespace: '/i1' },
};

describe('renderWorldShell', () => {
    it('ワールドタイトルと説明を含む SSR シェルを生成する', () => {
        const html = renderWorldShell({
            world: {
                id: 'test-world',
                displayName: 'テストワールド',
                description: 'これはテストです',
                ...baseWorld,
            },
            instances: [],
            publicBaseUrl: 'https://example.com',
            coreApiUrl: 'https://api.example.com',
        });

        expect(html).toContain('テストワールド');
        expect(html).toContain('これはテストです');
        expect(html).toContain('参加可能なインスタンスがありません');
        expect(html).toContain('data-world-shell');
    });

    it('サムネイル画像を含む', () => {
        const html = renderWorldShell({
            world: {
                id: 'thumb-world',
                displayName: 'サムネイル付き',
                thumbnail: 'https://cdn.example.com/thumb.png',
                ...baseWorld,
            },
            instances: [],
            publicBaseUrl: 'https://example.com',
            coreApiUrl: 'https://api.example.com',
        });

        expect(html).toContain('https://cdn.example.com/thumb.png');
        expect(html).toContain('alt="サムネイル付き"');
    });

    it('インスタンス一覧をレンダリングする', () => {
        const html = renderWorldShell({
            world: {
                id: 'instance-world',
                displayName: 'インスタンスあり',
                ...baseWorld,
            },
            instances: [baseInstance],
            publicBaseUrl: 'https://example.com',
            coreApiUrl: 'https://api.example.com',
        });

        expect(html).toContain('参加者 3 / 10');
        expect(html).not.toContain('参加可能なインスタンスがありません');
    });

    it('world が undefined の場合もクラッシュしない', () => {
        const html = renderWorldShell({
            world: undefined,
            instances: [],
            publicBaseUrl: 'https://example.com',
            coreApiUrl: 'https://api.example.com',
        });

        expect(html).toContain('data-world-shell');
    });

    it('XSS 対策：特殊文字をエスケープする', () => {
        const html = renderWorldShell({
            world: {
                id: 'xss-world',
                displayName: '<script>alert(1)</script>',
                description: '" onclick="alert(2)',
                ...baseWorld,
            },
            instances: [],
            publicBaseUrl: 'https://example.com',
            coreApiUrl: 'https://api.example.com',
        });

        expect(html).not.toContain('<script>alert(1)</script>');
        expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
        expect(html).not.toContain('" onclick="alert(2)');
    });
});
