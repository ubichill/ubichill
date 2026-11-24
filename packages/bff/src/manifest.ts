/** PWA の manifest（`/manifest.webmanifest`）。名前・アイコン・色はコントロールパネルの「全般」と「ブランディング」から。 */
import { DEFAULT_THEME_PRIMARY } from '@ubichill/shared';
import { type Site, summarize } from './site';

/** 起動の画面の背景（frontend のトークン colors.background と同じ） */
const BACKGROUND = '#faf6f0';

interface ManifestIcon {
    src: string;
    sizes: string;
    type?: string;
    purpose?: 'any';
}

export interface WebAppManifest {
    id: string;
    name: string;
    short_name: string;
    description: string;
    lang: string;
    start_url: string;
    scope: string;
    display: 'standalone';
    background_color: string;
    theme_color: string;
    icons: ManifestIcon[];
}

export function buildManifest(site: Site): WebAppManifest {
    return {
        id: '/',
        name: site.name,
        short_name: site.shortName,
        description: summarize(site.description, 300),
        lang: 'ja',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: BACKGROUND,
        theme_color: site.themeColor ?? DEFAULT_THEME_PRIMARY,
        icons: site.icon
            ? [
                  { src: site.icon.icon192, sizes: '192x192', type: 'image/png', purpose: 'any' },
                  { src: site.icon.icon512, sizes: '512x512', type: 'image/png', purpose: 'any' },
              ]
            : // 同梱のアイコンは拡張子と中身の形式が違うので、形式は書かずにブラウザーに見させる
              [{ src: site.defaultIcon, sizes: '1024x1024' }],
    };
}
