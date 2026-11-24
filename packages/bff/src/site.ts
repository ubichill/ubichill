/**
 * このサーバーの名前・紹介・ブランディング（core API の `GET /api/v1/server`）を、<head> を組み立てる形にまとめる。
 * BFF と backend は別々に更新されるので、古い backend の応答（branding が無い）や、読めなかったときは既定の見た目にする。
 */
import {
    DEFAULT_SERVER_BRANDING,
    DEFAULT_SERVER_DESCRIPTION,
    DEFAULT_SERVER_NAME,
    normalizeHexColor,
    type ServerIconUrls,
    type ServerOverview,
} from '@ubichill/shared';

export interface Site {
    publicBaseUrl: string;
    name: string;
    /** 狭い場所に出す名前（略称。無ければサーバー名） */
    shortName: string;
    /** 書いていなければ Ubichill の紹介 */
    description: string;
    /** `#rrggbb`。決めていなければ null */
    themeColor: string | null;
    icon: ServerIconUrls | null;
    banner: string | null;
    /** アイコンを決めていないときに出す、同梱のアイコン（絶対 URL） */
    defaultIcon: string;
}

/** 応答の一部（BFF が読むところ）。古い backend では branding が無い */
export type SiteSource = Pick<ServerOverview, 'info'> & Partial<Pick<ServerOverview, 'branding'>>;

export function siteOf(source: SiteSource | undefined, publicBaseUrl: string): Site {
    const branding = source?.branding ?? DEFAULT_SERVER_BRANDING;
    const name = source?.info.name || DEFAULT_SERVER_NAME;
    return {
        publicBaseUrl,
        name,
        shortName: branding.shortName || name,
        description: source?.info.description || DEFAULT_SERVER_DESCRIPTION,
        themeColor: branding.themeColor ? normalizeHexColor(branding.themeColor) : null,
        icon: branding.icon,
        banner: branding.banner,
        defaultIcon: `${publicBaseUrl}/icon.png`,
    };
}

const graphemes = new Intl.Segmenter('ja', { granularity: 'grapheme' });

/** 説明の欄に入れる長さに縮める（改行・空白をまとめ、絵文字などの 1 文字の途中で切らない） */
export function summarize(text: string, max = 200): string {
    const flat = text.replace(/\s+/g, ' ').trim();
    const chars = Array.from(graphemes.segment(flat), (s) => s.segment);
    return chars.length <= max ? flat : `${chars.slice(0, max - 1).join('')}…`;
}
