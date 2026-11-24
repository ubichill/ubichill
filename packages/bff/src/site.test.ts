import { DEFAULT_SERVER_DESCRIPTION, DEFAULT_SERVER_INFO } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import { siteOf, summarize } from './site';

const BASE = 'https://ubi.example';

describe('siteOf', () => {
    it('読めなかったときは既定の名前・紹介・同梱のアイコン', () => {
        expect(siteOf(undefined, BASE)).toEqual({
            publicBaseUrl: BASE,
            name: 'Ubichill',
            shortName: 'Ubichill',
            description: DEFAULT_SERVER_DESCRIPTION,
            themeColor: null,
            icon: null,
            banner: null,
            defaultIcon: `${BASE}/icon.png`,
        });
    });

    it('古い backend（branding が無い応答）でも名前と紹介は使う', () => {
        const site = siteOf({ info: { ...DEFAULT_SERVER_INFO, name: 'ようかん', description: '紹介' } }, BASE);
        expect(site).toMatchObject({ name: 'ようかん', shortName: 'ようかん', description: '紹介', icon: null });
    });

    it('略称が無ければサーバー名、色は形を確かめ直す（壊れた値は既定の色）', () => {
        const site = siteOf(
            {
                info: DEFAULT_SERVER_INFO,
                branding: { shortName: '', themeColor: '#1B2A44', icon: null, banner: null },
            },
            BASE,
        );
        expect(site).toMatchObject({ shortName: 'Ubichill', themeColor: '#1b2a44' });
        const broken = siteOf(
            {
                info: DEFAULT_SERVER_INFO,
                branding: { shortName: null, themeColor: 'red;}</style>', icon: null, banner: null },
            },
            BASE,
        );
        expect(broken.themeColor).toBeNull();
    });
});

describe('summarize', () => {
    it('改行・空白をまとめる', () => {
        expect(summarize('  一行目\n\n二行目\t三  ')).toBe('一行目 二行目 三');
    });

    it('長ければ … で終わる max 文字に縮める', () => {
        const out = summarize('あ'.repeat(5000), 200);
        expect([...out]).toHaveLength(200);
        expect(out.endsWith('…')).toBe(true);
        expect(summarize('あ'.repeat(200), 200)).toBe('あ'.repeat(200));
    });

    it('絵文字（結合したものも）の途中で切らない', () => {
        const family = '👨‍👩‍👧';
        const out = summarize(`${'あ'.repeat(8)}${family}${family}い`, 10);
        expect(out).toBe(`${'あ'.repeat(8)}${family}…`);
    });
});
