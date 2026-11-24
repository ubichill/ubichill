/**
 * どのページの <head> にも入れるもの: タブ・ホーム画面のアイコン、PWA の manifest、テーマの色。
 * ページごとのもの（タイトル・説明・OGP・noindex）は landing.ts・ogp.ts・plainPageTags。
 */
import { THEME_STYLE_ELEMENT_ID, themeStyleSheet } from '@ubichill/shared';
import { esc } from './html';
import { type Site, summarize } from './site';

export const MANIFEST_PATH = '/manifest.webmanifest';

export const NOINDEX_TAG = '<meta name="robots" content="noindex, nofollow">';

export function siteHeadTags(site: Site): string {
    const icon = site.icon;
    const style = site.themeColor ? themeStyleSheet(site.themeColor) : '';
    return [
        icon
            ? `<link rel="icon" type="image/png" sizes="32x32" href="${esc(icon.favicon)}">`
            : `<link rel="icon" href="${esc(site.defaultIcon)}">`,
        icon ? `<link rel="icon" type="image/png" sizes="192x192" href="${esc(icon.icon192)}">` : '',
        `<link rel="apple-touch-icon" href="${esc(icon?.appleTouchIcon ?? site.defaultIcon)}">`,
        `<link rel="manifest" href="${MANIFEST_PATH}">`,
        `<meta name="apple-mobile-web-app-title" content="${esc(site.shortName)}">`,
        // 読み込んだ画面が色を変える前から、決めた色で描く（一瞬だけ既定の色が見えないように）
        style ? `<style id="${THEME_STYLE_ELEMENT_ID}">${style}</style>` : '',
    ]
        .filter(Boolean)
        .join('\n');
}

/** サーバー名だけのページ（紹介のページ・ワールド・ユーザーのページ以外）の <title> と説明。本番以外は noindex */
export function plainPageTags(site: Site, enableCrawl: boolean): string {
    return [
        `<title>${esc(site.name)}</title>`,
        `<meta name="description" content="${esc(summarize(site.description))}">`,
        enableCrawl ? '' : NOINDEX_TAG,
    ]
        .filter(Boolean)
        .join('\n');
}
