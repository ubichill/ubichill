import { ENV_KEYS, SERVER_CONFIG } from '@ubichill/shared';
import { Router } from 'express';
import { worldRegistry } from '../services/worldRegistry';

/**
 * 公開ワールドページ（クローラ / SNS リンクプレビュー向け）。
 *
 * `/world/:id` は通常フロント（SPA）が表示するが、CSR のため bot にはメタが届かない。
 * nginx が bot の UA だけをこの backend ルートへプロキシし、OGP / JSON-LD 付き HTML を返す。
 * こうして「Web 検索・SNS 共有にワールドが出る」を成立させる（＝discovery の入口）。
 */

const router = Router();

const publicBaseUrl = (): string => (process.env[ENV_KEYS.PUBLIC_BASE_URL] || SERVER_CONFIG.DEV_URL).replace(/\/$/, '');

/** HTML 属性/本文へ安全に埋め込むためのエスケープ。 */
function esc(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

router.get('/:worldId', async (req, res) => {
    try {
        const worldId = req.params.worldId as string;
        const world = await worldRegistry.getWorld(worldId);
        if (!world) {
            res.status(404)
                .type('text/html')
                .send('<!doctype html><meta charset="utf-8"><title>World not found</title>');
            return;
        }

        const pageUrl = `${publicBaseUrl()}/world/${encodeURIComponent(worldId)}`;
        const title = `${world.displayName} — ubichill`;
        const desc = world.description ?? `${world.displayName} — ubichill のワールド`;
        const image = world.thumbnail ?? '';

        const jsonLd = JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'CreativeWork',
            name: world.displayName,
            description: desc,
            url: pageUrl,
            ...(image ? { image } : {}),
            ...(world.authorName ? { author: { '@type': 'Person', name: world.authorName } } : {}),
        });

        const html = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(pageUrl)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="ubichill">
<meta property="og:title" content="${esc(world.displayName)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(pageUrl)}">
${image ? `<meta property="og:image" content="${esc(image)}">` : ''}
<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}">
<meta name="twitter:title" content="${esc(world.displayName)}">
<meta name="twitter:description" content="${esc(desc)}">
${image ? `<meta name="twitter:image" content="${esc(image)}">` : ''}
<script type="application/ld+json">${jsonLd}</script>
</head>
<body>
<h1>${esc(world.displayName)}</h1>
${world.description ? `<p>${esc(world.description)}</p>` : ''}
<p><a href="${esc(pageUrl)}">ubichill で開く</a></p>
</body>
</html>`;

        res.type('text/html').send(html);
    } catch (error) {
        console.error('公開ワールドページ生成エラー:', error);
        res.status(500).type('text/html').send('<!doctype html><meta charset="utf-8"><title>Error</title>');
    }
});

export { router };
