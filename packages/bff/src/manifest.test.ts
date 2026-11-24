import { DEFAULT_SERVER_BRANDING, DEFAULT_SERVER_INFO, DEFAULT_THEME_PRIMARY } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import { buildManifest } from './manifest';
import { siteOf } from './site';

const BASE = 'https://ubi.example';

describe('buildManifest', () => {
    it('決めていなければ、サーバー名・既定の色・同梱のアイコン', () => {
        const manifest = buildManifest(siteOf(undefined, BASE));
        expect(manifest).toMatchObject({
            name: 'Ubichill',
            short_name: 'Ubichill',
            start_url: '/',
            display: 'standalone',
            theme_color: DEFAULT_THEME_PRIMARY,
            icons: [{ src: `${BASE}/icon.png`, sizes: '1024x1024' }],
        });
        expect(manifest.icons[0]).not.toHaveProperty('type');
    });

    it('略称・色・アイコン（192 と 512 の PNG）を使う', () => {
        const icon = { favicon: 'f', appleTouchIcon: 'a', icon192: `${BASE}/s.png`, icon512: `${BASE}/l.png` };
        const manifest = buildManifest(
            siteOf(
                {
                    info: { ...DEFAULT_SERVER_INFO, name: 'ようかんの Ubichill' },
                    branding: { ...DEFAULT_SERVER_BRANDING, shortName: 'ようかん', themeColor: '#2f6f4f', icon },
                },
                BASE,
            ),
        );
        expect(manifest).toMatchObject({ name: 'ようかんの Ubichill', short_name: 'ようかん', theme_color: '#2f6f4f' });
        expect(manifest.icons).toEqual([
            { src: `${BASE}/s.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: `${BASE}/l.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
        ]);
    });

    it('JSON にして読み戻しても同じ（名前の " や </script> も壊さない）', () => {
        const name = '"</script> ';
        const manifest = buildManifest(siteOf({ info: { ...DEFAULT_SERVER_INFO, name } }, BASE));
        expect(JSON.parse(JSON.stringify(manifest)).name).toBe(name);
    });
});
