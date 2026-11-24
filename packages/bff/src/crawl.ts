/**
 * 検索エンジン向け: robots.txt・sitemap.xml と、ワールドのページを検索に載せてよいかの判定。
 * 本番以外（NODE_ENV が production でない）はどれも載せない。
 */
import { HANDLE_PATTERN, type WorldListItem, worldShareUrl } from '@ubichill/shared';
import { esc } from './html';

/** sitemap 1 つに入れられる URL の数（sitemaps.org の上限） */
export const SITEMAP_MAX_URLS = 50_000;

/** ワールドの共有ページ（`/@handle/name`）。このサーバーのページで無ければ undefined。 */
export function sharePageUrl(world: WorldListItem | undefined, publicBaseUrl: string): string | undefined {
    if (world?.sharePath) return `${publicBaseUrl}${world.sharePath}`;
    const url = world ? worldShareUrl(world.url) : undefined;
    return url?.startsWith(`${publicBaseUrl}/@`) ? url : undefined;
}

/**
 * ワールドのページを検索に載せてよいか。このサーバーのワールドで、プライベートでないものだけ
 * （外部のファイル・連合のワールドは公式の内容として載せない。プライベートは作者のものだけに見せる）。
 */
export const isWorldIndexable = (world: WorldListItem | undefined): boolean =>
    !!world && world.source.kind === 'local' && world.visibility !== 'private';

export function buildRobotsTxt({
    enableCrawl,
    publicBaseUrl,
}: {
    enableCrawl: boolean;
    publicBaseUrl: string;
}): string {
    if (!enableCrawl) return 'User-agent: *\nDisallow: /\n';
    return [
        'User-agent: *',
        'Disallow: /api/',
        // OGP の画像（サーバーのバナー・アイコン、プロフィール画像、ワールドのサムネイル）は、カードを作るクローラーに読ませる
        'Allow: /api/v1/server/images/',
        'Allow: /api/v1/users/*/images/',
        'Allow: /api/v1/assets/',
        'Disallow: /realtime/',
        'Disallow: /instance/',
        'Disallow: /auth/',
        'Disallow: /worlds/new',
        'Disallow: /world/*/edit',
        `Sitemap: ${publicBaseUrl}/sitemap.xml`,
        '',
    ].join('\n');
}

export interface SitemapEntry {
    loc: string;
    lastmod?: string;
}

const isoDate = (value: string | undefined): string | undefined => {
    const time = value ? Date.parse(value) : Number.NaN;
    return Number.isFinite(time) ? new Date(time).toISOString() : undefined;
};

/**
 * sitemap に載せるページ: 紹介のページ、検索に載せてよいワールド、検索に出してよい人のページ。
 * 同じ URL は 1 回だけ、上限の数まで。
 */
export function sitemapEntries({
    publicBaseUrl,
    worlds,
    users,
}: {
    publicBaseUrl: string;
    worlds: readonly WorldListItem[];
    users: ReadonlyArray<{ handle: string; updatedAt?: string }>;
}): SitemapEntry[] {
    const candidates: SitemapEntry[] = [
        { loc: `${publicBaseUrl}/` },
        ...worlds.flatMap((world) => {
            const loc = isWorldIndexable(world) ? sharePageUrl(world, publicBaseUrl) : undefined;
            return loc ? [{ loc, lastmod: isoDate(world.updatedAt) }] : [];
        }),
        ...users.flatMap((user) =>
            HANDLE_PATTERN.test(user.handle)
                ? [{ loc: `${publicBaseUrl}/@${user.handle}`, lastmod: isoDate(user.updatedAt) }]
                : [],
        ),
    ];
    const seen = new Set<string>();
    return candidates
        .filter((entry) => {
            if (seen.has(entry.loc)) return false;
            seen.add(entry.loc);
            return true;
        })
        .slice(0, SITEMAP_MAX_URLS);
}

export function buildSitemap(entries: readonly SitemapEntry[]): string {
    const urls = entries.map(
        (entry) =>
            `  <url>\n    <loc>${esc(entry.loc)}</loc>\n${entry.lastmod ? `    <lastmod>${esc(entry.lastmod)}</lastmod>\n` : ''}  </url>`,
    );
    return [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        ...urls,
        '</urlset>',
        '',
    ].join('\n');
}
