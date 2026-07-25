/**
 * ワールドページの <head> メタ生成（OGP / Twitter Card / JSON-LD）。
 *
 * ルートハンドラから分離し、SEO タグ組み立てのロジックを一箇所に集約する。
 * 値の HTML/JSON エスケープはここで完結させ、呼び出し側は結果を <head> に流すだけ。
 */

import type { WorldListItem } from '@ubichill/shared';
import { esc, escJsonForScript } from './html';

interface MetaInput {
    world: WorldListItem | undefined;
    worldId: string;
    publicBaseUrl: string;
    /** 本番以外は noindex を付与する。 */
    enableCrawl: boolean;
}

/**
 * schema.org JSON-LD を生成する。仮想空間なので CreativeWork + VirtualLocation を併記。
 * @returns `<script type="application/ld+json">` の中身として安全な文字列
 */
export function buildJsonLd(world: WorldListItem | undefined, name: string, desc: string, url: string): string {
    const json = JSON.stringify({
        '@context': 'https://schema.org',
        '@type': ['CreativeWork', 'VirtualLocation'],
        name,
        description: desc,
        url,
        inLanguage: 'ja',
        ...(world?.thumbnail ? { image: world.thumbnail } : {}),
        ...(world?.authorName ? { author: { '@type': 'Person', name: world.authorName } } : {}),
        ...(world?.createdAt ? { datePublished: world.createdAt } : {}),
        ...(world?.updatedAt ? { dateModified: world.updatedAt } : {}),
    });
    return escJsonForScript(json);
}

/**
 * <head> に注入する meta/link/script タグ群を組み立てる。
 * @returns 改行区切りの HTML 文字列
 */
export function buildMetaTags({ world, worldId, publicBaseUrl, enableCrawl }: MetaInput): string {
    const name = world?.displayName ?? worldId;
    const desc = world?.description ?? `${name} — ubichill のワールド`;
    const url = `${publicBaseUrl}/world/${encodeURIComponent(worldId)}`;
    const image = world?.thumbnail ?? '';

    return [
        `<title>${esc(name)} — ubichill</title>`,
        `<meta name="description" content="${esc(desc)}">`,
        `<link rel="canonical" href="${esc(url)}">`,
        '<meta property="og:type" content="website">',
        '<meta property="og:site_name" content="ubichill">',
        `<meta property="og:title" content="${esc(name)}">`,
        `<meta property="og:description" content="${esc(desc)}">`,
        `<meta property="og:url" content="${esc(url)}">`,
        image ? `<meta property="og:image" content="${esc(image)}">` : '',
        // 実寸は不明なので width/height は捏造せず、代替テキストのみ明示する。
        image ? `<meta property="og:image:alt" content="${esc(name)}">` : '',
        `<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}">`,
        `<meta name="twitter:title" content="${esc(name)}">`,
        `<meta name="twitter:description" content="${esc(desc)}">`,
        image ? `<meta name="twitter:image" content="${esc(image)}">` : '',
        image ? `<meta name="twitter:image:alt" content="${esc(name)}">` : '',
        enableCrawl ? '' : '<meta name="robots" content="noindex, nofollow">',
        `<script type="application/ld+json">${buildJsonLd(world, name, desc, url)}</script>`,
    ]
        .filter(Boolean)
        .join('\n');
}
