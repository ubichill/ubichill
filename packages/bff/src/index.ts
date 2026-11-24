import fs from 'node:fs';
import path from 'node:path';
import {
    ENV_KEYS,
    HANDLE_PATTERN,
    type Instance,
    SERVER_CONFIG,
    type ServerOverview,
    type WorldListItem,
} from '@ubichill/shared';
import express from 'express';
import { buildRobotsTxt, buildSitemap, isWorldIndexable, sharePageUrl, sitemapEntries } from './crawl';
import { MANIFEST_PATH, plainPageTags, siteHeadTags } from './head';
import { buildLandingTags } from './landing';
import { buildManifest } from './manifest';
import { buildMetaTags, buildUserMetaTags, type UserPreview } from './ogp';
import { createRefreshing } from './refreshing';
import { renderShell } from './shell';
import { type Site, siteOf } from './site';
import { staticAssetHeaders } from './staticHeaders';
import { renderWorldShell } from './worldShell';

/**
 * BFF（Backend For Frontend）— フロント配信層。
 *
 * - SPA（Vite ビルド）を配信する。どのページの <head> にも、サーバーのアイコン・manifest・テーマの色を入れる。
 * - `/` は紹介のページの OGP / JSON-LD、`/world/:id`・`/@handle/name` は core API からワールド情報＋インスタンス一覧を取り、
 *   OGP / Twitter / JSON-LD を、<body> に SSR シェルを注入する（bot も人間も同一 HTML＝UA 判定・クローキング不要）。
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
const indexHtmlCache: { html?: string } = {};
function readIndexHtml(): string {
    indexHtmlCache.html ??= fs.readFileSync(path.join(DIST, 'index.html'), 'utf-8');
    return indexHtmlCache.html;
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

// サーバーの名前・ブランディング。管理者が変えてから、ほかの BFF にも 30 秒で届く
const siteSource = createRefreshing({
    load: () => fetchJson<ServerOverview>(`${CORE_API_URL}/api/v1/server`, 1500),
    ttlMs: 30_000,
    retryMs: 5_000,
});
const currentSite = async (): Promise<Site> => siteOf(await siteSource.get(), PUBLIC_BASE_URL);

// sitemap はワールドを全部解決して作るので重い。1 時間覚えておく
const sitemapXml = createRefreshing({
    load: async () => {
        const [worlds, directory] = await Promise.all([
            fetchJson<{ worlds?: WorldListItem[] }>(`${CORE_API_URL}/api/v1/worlds?scope=local`, 10_000),
            fetchJson<{ users?: Array<{ handle: string; updatedAt?: string }> }>(
                `${CORE_API_URL}/api/v1/server/directory`,
                10_000,
            ),
        ]);
        if (!worlds || !directory) return undefined;
        return buildSitemap(
            sitemapEntries({
                publicBaseUrl: PUBLIC_BASE_URL,
                worlds: worlds.worlds ?? [],
                users: directory.users ?? [],
            }),
        );
    },
    ttlMs: 60 * 60 * 1000,
    retryMs: 60 * 1000,
});

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

/** SPA の HTML に、どのページにも入れるもの（アイコン・manifest・色）とページの <head>・SSR シェルを入れて返す。 */
function sendPage(res: express.Response, site: Site, pageTags: string, bodyShell = '', status = 200): void {
    res.status(status)
        // 管理者が名前・アイコン・色を変えたら、次に開いたときに出るよう毎回確かめさせる
        .set('Cache-Control', 'no-cache')
        .type('html')
        .send(renderShell(readIndexHtml(), `${siteHeadTags(site)}\n${pageTags}`, bodyShell));
}

/** 素の SPA（サーバー名だけのタイトル）。ページの情報を作れなかったときにも使う。 */
async function sendPlainPage(res: express.Response, status = 200): Promise<void> {
    const site = await currentSite();
    sendPage(res, site, plainPageTags(site, ENABLE_CRAWL), '', status);
}

// 本番以外は、HTML 以外（画像・manifest など）も検索に載せない
if (!ENABLE_CRAWL) {
    app.use((_req, res, next) => {
        res.set('X-Robots-Tag', 'noindex, nofollow');
        next();
    });
}

// 紹介のページ（ログインしていない人の /）。ログインしている人には SPA がホームを出す（HTML は同じ）
app.get('/', async (_req, res) => {
    const site = await currentSite();
    sendPage(res, site, buildLandingTags(site, ENABLE_CRAWL));
});

app.get(MANIFEST_PATH, async (_req, res) => {
    res.set('Cache-Control', 'no-cache')
        .type('application/manifest+json')
        .send(JSON.stringify(buildManifest(await currentSite())));
});

// <link rel="icon"> を読まないクライアント（フィードリーダーなど）が見に来る場所
app.get('/favicon.ico', async (_req, res) => {
    const site = await currentSite();
    res.set('Cache-Control', 'no-cache').redirect(302, site.icon?.favicon ?? site.defaultIcon);
});

/** 外部 YAML の共有ページ。ワールド/サーバーの事前登録は不要。 */
app.get('/world', async (req, res) => {
    const worldRef = typeof req.query.url === 'string' ? req.query.url.trim() : '';
    if (!/^https?:\/\//i.test(worldRef)) {
        await sendPlainPage(res, 400);
        return;
    }
    try {
        const [site, { world, instances }] = await Promise.all([currentSite(), fetchWorldPageData(worldRef)]);
        // 作者が確かめられ登録されたワールドは、短い共有ページ（/@handle/name）を正規の URL にする
        const pageUrl =
            sharePageUrl(world, PUBLIC_BASE_URL) ?? `${PUBLIC_BASE_URL}/world?url=${encodeURIComponent(worldRef)}`;
        const worldId = world?.id ?? 'external-world';
        const tags = buildMetaTags({
            site,
            world,
            worldId,
            publicBaseUrl: PUBLIC_BASE_URL,
            pageUrl,
            // 外部ファイルは閲覧・共有できるが、本体が公式コンテンツとして検索登録しない。
            enableCrawl: false,
        });
        const bodyShell = renderWorldShell({
            site,
            world,
            instances,
            publicBaseUrl: PUBLIC_BASE_URL,
            coreApiUrl: CORE_API_URL,
        });
        sendPage(res, site, tags, bodyShell);
    } catch (err) {
        console.error('外部ワールド OGP/SSR 生成失敗:', err);
        await sendPlainPage(res);
    }
});

/** ワールドのページ（共有 URL・以前の ID の URL）。このサーバーのパブリックなワールドだけを検索に載せる。 */
async function sendWorldPage(
    res: express.Response,
    page: { worldRef: string; worldId: (world: WorldListItem | undefined) => string; fallbackUrl?: string },
) {
    const [site, { world, instances }] = await Promise.all([currentSite(), fetchWorldPageData(page.worldRef)]);
    const tags = buildMetaTags({
        site,
        world,
        worldId: page.worldId(world),
        publicBaseUrl: PUBLIC_BASE_URL,
        pageUrl: sharePageUrl(world, PUBLIC_BASE_URL) ?? page.fallbackUrl,
        enableCrawl: ENABLE_CRAWL && isWorldIndexable(world),
    });
    const bodyShell = renderWorldShell({
        site,
        world,
        instances,
        publicBaseUrl: PUBLIC_BASE_URL,
        coreApiUrl: CORE_API_URL,
    });
    sendPage(res, site, tags, bodyShell);
}

// 公開ワールドページ（共有 URL /@handle/name）: OGP/JSON-LD/SSR シェルを注入した SPA シェルを全員に返す。
app.get('/@:handle/:name', async (req, res, next) => {
    const { handle, name } = req.params;
    if (!HANDLE_PATTERN.test(handle) || !/^[a-z0-9-]+$/.test(name)) {
        next();
        return;
    }
    try {
        await sendWorldPage(res, {
            worldRef: `@${handle}/${name}`,
            worldId: (world) => world?.id ?? name,
            fallbackUrl: `${PUBLIC_BASE_URL}/@${handle}/${name}`,
        });
    } catch (err) {
        console.error('OGP/SSR 生成失敗:', err);
        await sendPlainPage(res);
    }
});

/** ユーザーページの <head>（名前・アイコン・説明）を付けた SPA シェルを返す。 */
async function sendUserPage(res: express.Response, user: UserPreview | undefined, handle: string): Promise<void> {
    const [site, worlds] = await Promise.all([
        currentSite(),
        user
            ? fetchJson<{ worlds?: unknown[] }>(`${CORE_API_URL}/api/v1/users/${encodeURIComponent(user.id)}/worlds`)
            : undefined,
    ]);
    const tags = buildUserMetaTags({
        site,
        user,
        handle,
        worldCount: worlds?.worlds?.length,
        publicBaseUrl: PUBLIC_BASE_URL,
        pageUrl: `${PUBLIC_BASE_URL}/@${user?.handle ?? handle}`,
        enableCrawl: ENABLE_CRAWL,
    });
    sendPage(res, site, tags);
}

// ユーザーページ（/@ID）。共有できるよう、ログインなしでも名前・アイコン・説明のプレビューを出す。
app.get('/@:handle', async (req, res, next) => {
    const handle = req.params.handle.toLowerCase();
    if (!HANDLE_PATTERN.test(handle)) {
        next();
        return;
    }
    try {
        const user = await fetchJson<UserPreview>(`${CORE_API_URL}/api/v1/social/users/by-handle/${handle}`);
        await sendUserPage(res, user, handle);
    } catch (err) {
        console.error('ユーザーページの OGP 生成失敗:', err);
        await sendPlainPage(res);
    }
});

// ユーザーページ（内部 ID）。正規の URL は /@ID
app.get('/user/:userId', async (req, res) => {
    try {
        const user = await fetchJson<UserPreview>(
            `${CORE_API_URL}/api/v1/social/users/${encodeURIComponent(req.params.userId)}`,
        );
        await sendUserPage(res, user, user?.handle ?? req.params.userId);
    } catch (err) {
        console.error('ユーザーページの OGP 生成失敗:', err);
        await sendPlainPage(res);
    }
});

// 以前の共有 URL（/world/:id）。正規のページ URL は共有 URL（SPA が /@handle/name へ移す）
app.get('/world/:worldId', async (req, res) => {
    try {
        const worldId = req.params.worldId;
        await sendWorldPage(res, { worldRef: worldId, worldId: () => worldId });
    } catch (err) {
        console.error('OGP/SSR 生成失敗:', err);
        await sendPlainPage(res);
    }
});

app.get('/robots.txt', (_req, res) => {
    res.set('Cache-Control', 'public, max-age=3600')
        .type('text/plain')
        .send(buildRobotsTxt({ enableCrawl: ENABLE_CRAWL, publicBaseUrl: PUBLIC_BASE_URL }));
});

// sitemap.xml — 本番のみ。紹介のページ・パブリックなワールド・検索に出してよい人のページ
app.get('/sitemap.xml', async (_req, res) => {
    if (!ENABLE_CRAWL) {
        res.status(404).send();
        return;
    }
    const xml = await sitemapXml.get();
    if (!xml) {
        res.status(503).set('Retry-After', '60').send();
        return;
    }
    res.set('Cache-Control', 'public, max-age=3600').type('application/xml').send(xml);
});

// 静的アセット（Sandbox Worker の CSP、/mods は no-cache、ハッシュ付きは immutable）
app.use(
    express.static(DIST, {
        index: false,
        setHeaders: (res, filePath) => {
            for (const [name, value] of Object.entries(staticAssetHeaders(filePath.split(path.sep).join('/')))) {
                res.setHeader(name, value);
            }
        },
    }),
);

// SPA フォールバック（Express 5 は `'*'` パス不可のため最終 middleware で index.html を返す）
app.use(async (_req, res) => {
    await sendPlainPage(res);
});

app.listen(PORT, () => {
    console.log(`BFF listening on :${PORT} (dist=${DIST}, core=${CORE_API_URL})`);
});
