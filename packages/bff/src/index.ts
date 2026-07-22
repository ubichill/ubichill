import fs from 'node:fs';
import path from 'node:path';
import { ENV_KEYS, type Instance, SERVER_CONFIG, type WorldListItem } from '@ubichill/shared';
import express from 'express';
import { renderWorldShell } from './worldShell';

/**
 * BFF（Backend For Frontend）— フロント配信層。
 *
 * - SPA（Vite ビルド）を配信する。
 * - `/world/:id` は core API からワールド情報＋インスタンス一覧を取り、index.html の <head> に
 *   OGP / Twitter / JSON-LD を、<body> に SSR シェルを注入する（bot も人間も同一 HTML＝
 *   UA 判定・クローキング不要）。
 * - core backend は `/api` `/socket.io`（Ingress が直接ルーティング）でドメイン API に純化。
 */

const PORT = Number(process.env.PORT ?? 3000);
/** Vite ビルド成果物。Docker では BFF と同じイメージに同梱する。 */
const DIST = process.env.FRONTEND_DIST
    ? path.resolve(process.env.FRONTEND_DIST)
    : path.resolve(__dirname, '../../frontend/dist');
/** core backend の内部到達 URL（サーバー間で world メタを取得する）。 */
const CORE_API_URL = (process.env.CORE_API_URL || SERVER_CONFIG.DEV_URL).replace(/\/$/, '');
/** 外部公開 base URL（og:url / canonical / sitemap 用）。 */
const PUBLIC_BASE_URL = (process.env[ENV_KEYS.PUBLIC_BASE_URL] || `http://localhost:${PORT}`).replace(/\/$/, '');
/** クローラー向けコンテンツを有効にするか（本番のみ）。 */
const ENABLE_CRAWL = process.env.NODE_ENV === 'production';

const app = express();

function esc(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/** index.html はデプロイ毎に不変なので一度だけ読んでキャッシュする（ホットパス）。 */
let _indexHtml: string | undefined;
function readIndexHtml(): string {
    if (_indexHtml === undefined) {
        _indexHtml = fs.readFileSync(path.join(DIST, 'index.html'), 'utf-8');
    }
    return _indexHtml;
}

/**
 * core API にタイムアウト付きで GET する。
 * 失敗/タイムアウト時は undefined を返し、呼び出し側が素の SPA フォールバックする。
 */
async function fetchJson<T>(url: string, timeoutMs = 3000): Promise<T | undefined> {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
        const r = await fetch(url, { headers: { Accept: 'application/json' }, signal: ac.signal });
        if (!r.ok) return undefined;
        return (await r.json()) as T;
    } catch {
        return undefined;
    } finally {
        clearTimeout(timer);
    }
}

interface WorldPageData {
    world: WorldListItem | undefined;
    instances: Instance[];
}

async function fetchWorldPageData(worldId: string): Promise<WorldPageData> {
    const world = await fetchJson<WorldListItem>(`${CORE_API_URL}/api/v1/worlds/${encodeURIComponent(worldId)}`);
    const instancesRes = await fetchJson<{ instances: Instance[] }>(
        `${CORE_API_URL}/api/v1/instances?worldId=${encodeURIComponent(worldId)}`,
    );
    return { world, instances: instancesRes?.instances ?? [] };
}

/** index.html の <head> に meta を注入し、<body> 内の root 要素に SSR シェルを注入する。 */
function renderShell(metaTags: string, bodyShell: string): string {
    return readIndexHtml()
        .replace(/<title>.*?<\/title>/i, '')
        .replace('</head>', `${metaTags}\n</head>`)
        .replace(/<div id="root"><\/div>/, `<div id="root">${bodyShell}</div>`);
}

// 公開ワールドページ: OGP/JSON-LD/SSR シェルを注入した SPA シェルを全員に返す。
app.get('/world/:worldId', async (req, res) => {
    const worldId = req.params.worldId;
    try {
        const { world, instances } = await fetchWorldPageData(worldId);
        const name = world?.displayName ?? worldId;
        const desc = world?.description ?? `${name} — ubichill のワールド`;
        const url = `${PUBLIC_BASE_URL}/world/${encodeURIComponent(worldId)}`;
        const image = world?.thumbnail ?? '';
        const jsonLd = JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'CreativeWork',
            name,
            description: desc,
            url,
            ...(image ? { image } : {}),
            ...(world?.authorName ? { author: { '@type': 'Person', name: world.authorName } } : {}),
        });
        const tags = [
            `<title>${esc(name)} — ubichill</title>`,
            `<meta name="description" content="${esc(desc)}">`,
            `<link rel="canonical" href="${esc(url)}">`,
            '<meta property="og:type" content="website">',
            '<meta property="og:site_name" content="ubichill">',
            `<meta property="og:title" content="${esc(name)}">`,
            `<meta property="og:description" content="${esc(desc)}">`,
            `<meta property="og:url" content="${esc(url)}">`,
            image ? `<meta property="og:image" content="${esc(image)}">` : '',
            `<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}">`,
            `<meta name="twitter:title" content="${esc(name)}">`,
            `<meta name="twitter:description" content="${esc(desc)}">`,
            image ? `<meta name="twitter:image" content="${esc(image)}">` : '',
            ENABLE_CRAWL ? '' : '<meta name="robots" content="noindex, nofollow">',
            `<script type="application/ld+json">${jsonLd}</script>`,
        ]
            .filter(Boolean)
            .join('\n');

        const bodyShell = renderWorldShell({
            world,
            instances,
            publicBaseUrl: PUBLIC_BASE_URL,
            coreApiUrl: CORE_API_URL,
        });
        res.type('html').send(renderShell(tags, bodyShell));
    } catch (err) {
        console.error('OGP/SSR 生成失敗:', err);
        res.type('html').send(readIndexHtml());
    }
});

// robots.txt — 本番のみクロールを許可する。
app.get('/robots.txt', (_req, res) => {
    res.type('text/plain');
    if (!ENABLE_CRAWL) {
        res.send('User-agent: *\nDisallow: /');
        return;
    }
    res.send(
        'User-agent: *\n' +
            'Allow: /world/\n' +
            'Disallow: /api/\n' +
            'Disallow: /socket.io/\n' +
            'Disallow: /instance/\n' +
            'Disallow: /auth/\n' +
            'Disallow: /worlds/new\n' +
            'Disallow: /world/*/edit\n' +
            `Sitemap: ${PUBLIC_BASE_URL}/sitemap.xml\n`,
    );
});

// sitemap.xml — 本番のみ。core API の全ワールドを列挙する。
app.get('/sitemap.xml', async (_req, res) => {
    if (!ENABLE_CRAWL) {
        res.status(404).send();
        return;
    }
    try {
        const data = await fetchJson<{ worlds?: Array<{ id?: string; updatedAt?: string }> }>(
            `${CORE_API_URL}/api/v1/worlds`,
            5000,
        );
        if (!data) {
            res.status(500).send();
            return;
        }
        const urls = (data.worlds ?? [])
            .filter((w): w is { id: string; updatedAt?: string } => typeof w.id === 'string')
            .map((w) => {
                const loc = `${PUBLIC_BASE_URL}/world/${encodeURIComponent(w.id)}`;
                const lastmod = w.updatedAt ? `    <lastmod>${esc(w.updatedAt)}</lastmod>\n` : '';
                return `  <url>\n    <loc>${esc(loc)}</loc>\n${lastmod}  </url>`;
            })
            .join('\n');
        res.type('application/xml').send(
            `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`,
        );
    } catch (err) {
        console.error('sitemap 生成失敗:', err);
        res.status(500).send();
    }
});

// 静的アセット（/mods は no-cache、ハッシュ付きは immutable）
app.use(
    express.static(DIST, {
        index: false,
        setHeaders: (res, filePath) => {
            if (filePath.includes(`${path.sep}mods${path.sep}`)) {
                res.setHeader('Cache-Control', 'public, no-cache');
            } else if (/\.[0-9a-f]{8,}\.\w+$/i.test(filePath)) {
                res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
            }
        },
    }),
);

// SPA フォールバック（Express 5 は `'*'` パス不可のため最終 middleware で index.html を返す）
app.use((_req, res) => {
    res.type('html').send(readIndexHtml());
});

app.listen(PORT, () => {
    console.log(`🌐 BFF listening on :${PORT} (dist=${DIST}, core=${CORE_API_URL})`);
});
