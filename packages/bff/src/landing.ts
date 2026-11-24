/**
 * 紹介のページ（`/`）の <head>: タイトル・説明・OGP・Twitter Card・JSON-LD（WebSite と Organization）。
 * 中身はコントロールパネルの「全般」（名前・紹介）と「ブランディング」（バナー・アイコン・略称）。
 */
import { NOINDEX_TAG } from './head';
import { esc, escJsonForScript } from './html';
import { type Site, summarize } from './site';

interface OgImage {
    url: string;
    width: number;
    height: number;
    /** 同梱のアイコンは拡張子と中身の形式が違うので書かない */
    type: string | null;
    large: boolean;
}

/** バナーがあれば大きいカード、無ければアイコンの小さいカード */
function ogImageOf(site: Site): OgImage {
    if (site.banner) return { url: site.banner, width: 1200, height: 630, type: 'image/webp', large: true };
    if (site.icon) return { url: site.icon.icon512, width: 512, height: 512, type: 'image/png', large: false };
    return { url: site.defaultIcon, width: 1024, height: 1024, type: null, large: false };
}

/** schema.org の WebSite（サイト名の表示）と Organization（運営とロゴ） */
export function buildLandingJsonLd(site: Site): string {
    const home = `${site.publicBaseUrl}/`;
    const organization = `${home}#organization`;
    return escJsonForScript(
        JSON.stringify({
            '@context': 'https://schema.org',
            '@graph': [
                {
                    '@type': 'WebSite',
                    '@id': `${home}#website`,
                    url: home,
                    name: site.name,
                    ...(site.shortName !== site.name ? { alternateName: site.shortName } : {}),
                    description: summarize(site.description, 500),
                    inLanguage: 'ja',
                    publisher: { '@id': organization },
                },
                {
                    '@type': 'Organization',
                    '@id': organization,
                    url: home,
                    name: site.name,
                    logo: site.icon?.icon512 ?? site.defaultIcon,
                },
            ],
        }),
    );
}

export function buildLandingTags(site: Site, enableCrawl: boolean): string {
    const url = `${site.publicBaseUrl}/`;
    const description = summarize(site.description);
    const image = ogImageOf(site);
    return [
        `<title>${esc(site.name)}</title>`,
        `<meta name="description" content="${esc(description)}">`,
        `<link rel="canonical" href="${esc(url)}">`,
        '<meta property="og:type" content="website">',
        `<meta property="og:site_name" content="${esc(site.name)}">`,
        `<meta property="og:title" content="${esc(site.name)}">`,
        `<meta property="og:description" content="${esc(description)}">`,
        `<meta property="og:url" content="${esc(url)}">`,
        '<meta property="og:locale" content="ja_JP">',
        `<meta property="og:image" content="${esc(image.url)}">`,
        image.type ? `<meta property="og:image:type" content="${image.type}">` : '',
        `<meta property="og:image:width" content="${image.width}">`,
        `<meta property="og:image:height" content="${image.height}">`,
        `<meta property="og:image:alt" content="${esc(site.name)}">`,
        `<meta name="twitter:card" content="${image.large ? 'summary_large_image' : 'summary'}">`,
        `<meta name="twitter:title" content="${esc(site.name)}">`,
        `<meta name="twitter:description" content="${esc(description)}">`,
        `<meta name="twitter:image" content="${esc(image.url)}">`,
        `<meta name="twitter:image:alt" content="${esc(site.name)}">`,
        enableCrawl ? '' : NOINDEX_TAG,
        `<script type="application/ld+json">${buildLandingJsonLd(site)}</script>`,
    ]
        .filter(Boolean)
        .join('\n');
}
