import fs from 'node:fs';
import path from 'node:path';
import {
    ENV_KEYS,
    HANDLE_PATTERN,
    type Instance,
    SERVER_CONFIG,
    type UserSummary,
    type WorldListItem,
    worldShareUrl,
} from '@ubichill/shared';
import express from 'express';
import { esc } from './html';
import { buildMetaTags, buildUserMetaTags } from './ogp';
import { renderWorldShell } from './worldShell';

/**
 * BFF（Backend For Frontend）— フロント配信層。
 *
 * - SPA（Vite ビルド）を配信する。
 * - `/world/:id` は core API からワールド情報＋インスタンス一覧を取り、index.html の <head> に
 *   OGP / Twitter / JSON-LD を、<body> に SSR シェルを注入する（bot も人間も同一 HTML＝
 *   UA 判定・クローキング不要）。
 * - core backend は `/api`、インスタンス通信は Go の `/realtime/v1/ws`（いずれも Ingress が直接ルーティング）。
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

/** `worldRef` は URL・`@handle/name`（共有 URL のパス）・内部 ID のどれでもよい。 */
async function fetchWorldPageData(worldRef: string): Promise<WorldPageData> {
    const author = /^@([^/]+)\/([^/]+)$/.exec(worldRef);
    const worldPath = author
        ? `/api/v1/authors/${encodeURIComponent(author[1] as string)}/worlds/${encodeURIComponent(author[2] as string)}`
        : /^https?:\/\//i.test(worldRef)
          ? `/api/v1/worlds/resolve?url=${encodeURIComponent(worldRef)}`
          : `/api/v1/worlds/${encodeURIComponent(worldRef)}`;
    const world = await fetchJson<WorldListItem>(`${CORE_API_URL}${worldPath}`);
    const instancesRes = await fetchJson<{ instances: Instance[] }>(
        `${CORE_API_URL}/api/v1/instances?worldId=${encodeURIComponent(worldRef)}`,
    );
    return { world, instances: instancesRes?.instances ?? [] };
}

/**
 * index.html の <head> に meta を注入し、<body> 内の root 要素に SSR シェルを注入する。
 * 置換値は関数リプレーサで渡す。文字列リプレーサだと metaTags/bodyShell 内の `$&` `$'`
 * などが String.replace に特殊解釈され、HTML が壊れる/意図しない断片が混入するため。
 */
function renderShell(metaTags: string, bodyShell: string): string {
    return readIndexHtml()
        .replace(/<title>.*?<\/title>/i, '')
        .replace('</head>', () => `${metaTags}\n</head>`)
        .replace(/<div id="root"><\/div>/, () => `<div id="root">${bodyShell}</div>`);
}

/** 外部 YAML の共有ページ。ワールド/サーバーの事前登録は不要。 */
app.get('/world', async (req, res) => {
    const worldRef = typeof req.query.url === 'string' ? req.query.url.trim() : '';
    if (!/^https?:\/\//i.test(worldRef)) {
        res.status(400).type('html').send(readIndexHtml());
        return;
    }
    try {
        const { world, instances } = await fetchWorldPageData(worldRef);
        const pageUrl = `${PUBLIC_BASE_URL}/world?url=${encodeURIComponent(worldRef)}`;
        const worldId = world?.id ?? 'external-world';
        const tags = buildMetaTags({
            world,
            worldId,
            publicBaseUrl: PUBLIC_BASE_URL,
            pageUrl,
            // 外部ファイルは閲覧・共有できるが、本体が公式コンテンツとして検索登録しない。
            enableCrawl: false,
        });
        const bodyShell = renderWorldShell({
            world,
            instances,
            publicBaseUrl: PUBLIC_BASE_URL,
            coreApiUrl: CORE_API_URL,
        });
        res.type('html').send(renderShell(tags, bodyShell));
    } catch (err) {
        console.error('外部ワールド OGP/SSR 生成失敗:', err);
        res.type('html').send(readIndexHtml());
    }
});

/** ワールドの共有 URL（`/@handle/name`）。このサーバーのワールドでなければ undefined。 */
function sharePageUrl(world: WorldListItem | undefined): string | undefined {
    const url = world ? worldShareUrl(world.url) : undefined;
    return url?.startsWith(`${PUBLIC_BASE_URL}/@`) ? url : undefined;
}

// 公開ワールドページ（共有 URL /@handle/name）: OGP/JSON-LD/SSR シェルを注入した SPA シェルを全員に返す。
app.get('/@:handle/:name', async (req, res, next) => {
    const { handle, name } = req.params;
    if (!HANDLE_PATTERN.test(handle) || !/^[a-z0-9-]+$/.test(name)) {
        next();
        return;
    }
    try {
        const { world, instances } = await fetchWorldPageData(`@${handle}/${name}`);
        const tags = buildMetaTags({
            world,
            worldId: world?.id ?? name,
            publicBaseUrl: PUBLIC_BASE_URL,
            pageUrl: sharePageUrl(world) ?? `${PUBLIC_BASE_URL}/@${handle}/${name}`,
            enableCrawl: ENABLE_CRAWL,
        });
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

/** ユーザーページの <head>（名前・アイコン・説明）を付けた SPA シェルを返す。 */
async function sendUserPage(res: express.Response, user: UserSummary | undefined, handle: string): Promise<void> {
    const worlds = user
        ? await fetchJson<{ worlds?: unknown[] }>(`${CORE_API_URL}/api/v1/users/${encodeURIComponent(user.id)}/worlds`)
        : undefined;
    const pageUrl = `${PUBLIC_BASE_URL}${user?.handle ? `/@${user.handle}` : user ? `/user/${encodeURIComponent(user.id)}` : `/@${handle}`}`;
    const tags = buildUserMetaTags({
        user,
        handle,
        worldCount: worlds?.worlds?.length,
        publicBaseUrl: PUBLIC_BASE_URL,
        pageUrl,
        enableCrawl: ENABLE_CRAWL,
    });
    res.type('html').send(renderShell(tags, ''));
}

// ユーザーページ（/@ID）。共有できるよう、ログインなしでも名前・アイコン・説明のプレビューを出す。
app.get('/@:handle', async (req, res, next) => {
    const handle = req.params.handle.toLowerCase();
    if (!HANDLE_PATTERN.test(handle)) {
        next();
        return;
    }
    try {
        const user = await fetchJson<UserSummary>(`${CORE_API_URL}/api/v1/social/users/by-handle/${handle}`);
        await sendUserPage(res, user, handle);
    } catch (err) {
        console.error('ユーザーページの OGP 生成失敗:', err);
        res.type('html').send(readIndexHtml());
    }
});

// ユーザーページ（内部 ID）。正規の URL は ID があれば /@ID
app.get('/user/:userId', async (req, res) => {
    try {
        const user = await fetchJson<UserSummary>(
            `${CORE_API_URL}/api/v1/social/users/${encodeURIComponent(req.params.userId)}`,
        );
        await sendUserPage(res, user, user?.handle ?? req.params.userId);
    } catch (err) {
        console.error('ユーザーページの OGP 生成失敗:', err);
        res.type('html').send(readIndexHtml());
    }
});

// 以前の共有 URL（/world/:id）。正規のページ URL は共有 URL（SPA が /@handle/name へ移す）
app.get('/world/:worldId', async (req, res) => {
    const worldId = req.params.worldId;
    try {
        const { world, instances } = await fetchWorldPageData(worldId);
        const tags = buildMetaTags({
            world,
            worldId,
            publicBaseUrl: PUBLIC_BASE_URL,
            pageUrl: sharePageUrl(world),
            enableCrawl: ENABLE_CRAWL,
        });
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
            'Allow: /@\n' +
            'Disallow: /api/\n' +
            'Disallow: /realtime/\n' +
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
        const data = await fetchJson<{ worlds?: WorldListItem[] }>(`${CORE_API_URL}/api/v1/worlds`, 5000);
        if (!data) {
            res.status(500).send();
            return;
        }
        const urls = (data.worlds ?? [])
            .flatMap((w) => {
                const loc = sharePageUrl(w);
                return loc ? [{ loc, updatedAt: w.updatedAt }] : [];
            })
            .map((w) => {
                const loc = w.loc;
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
