import { describe, expect, it } from 'vitest';
import {
    isServerImageVariant,
    ServerBrandingUpdateSchema,
    serverBrandingImages,
    serverImageHashOf,
    serverImagePath,
    serverImageVariantsOf,
} from './branding';

const HASH = 'a'.repeat(43);

describe('ServerBrandingUpdateSchema', () => {
    it('前後の空白を落とし、空は null（決めていない）にする', () => {
        expect(ServerBrandingUpdateSchema.parse({ shortName: '  ようかん ', themeColor: '  ' })).toEqual({
            shortName: 'ようかん',
            themeColor: null,
        });
        expect(ServerBrandingUpdateSchema.parse({ shortName: null, themeColor: null })).toEqual({
            shortName: null,
            themeColor: null,
        });
    });

    it('色は #rrggbb の小文字にそろえる', () => {
        expect(ServerBrandingUpdateSchema.parse({ shortName: null, themeColor: '#1B2A44' }).themeColor).toBe('#1b2a44');
        expect(ServerBrandingUpdateSchema.parse({ shortName: null, themeColor: '#123' }).themeColor).toBe('#112233');
    });

    it('ボタンの文字が読めない色は、理由を付けて断る', () => {
        const result = ServerBrandingUpdateSchema.safeParse({ shortName: null, themeColor: '#f0f0f0' });
        expect(result.success).toBe(false);
        expect(result.error?.issues[0]?.message).toMatch(/明るすぎ/);
    });

    it.each(['red', 'javascript:alert(1)', '#000;}</style>'])('色でない %j は断る', (themeColor) => {
        expect(ServerBrandingUpdateSchema.safeParse({ shortName: null, themeColor }).success).toBe(false);
    });

    it('略称は 16 文字まで', () => {
        expect(ServerBrandingUpdateSchema.safeParse({ shortName: 'あ'.repeat(16), themeColor: null }).success).toBe(
            true,
        );
        const long = ServerBrandingUpdateSchema.safeParse({ shortName: 'あ'.repeat(17), themeColor: null });
        expect(long.error?.issues[0]?.message).toBe('略称は 16 文字までにしてください');
    });

    it('項目が欠けた本文は断る（片方だけ送って、もう片方を消してしまわない）', () => {
        expect(ServerBrandingUpdateSchema.safeParse({ shortName: 'x' }).success).toBe(false);
        expect(ServerBrandingUpdateSchema.safeParse(null).success).toBe(false);
    });
});

describe('画像の種類と URL', () => {
    it('アイコンからはタブ・iOS・PWA の 4 つ、バナーからは 1 つ作る', () => {
        expect(serverImageVariantsOf('icon')).toEqual(['favicon', 'apple-touch-icon', 'icon-192', 'icon-512']);
        expect(serverImageVariantsOf('banner')).toEqual(['banner']);
    });

    it('知らない種類・Object の持ち物を種類にしない', () => {
        expect(isServerImageVariant('icon-192')).toBe(true);
        expect(isServerImageVariant('toString')).toBe(false);
        expect(isServerImageVariant('__proto__')).toBe(false);
        expect(isServerImageVariant(undefined)).toBe(false);
    });

    it('パスは種類の形式の拡張子にし、同じ拡張子のファイル名からだけハッシュを取り出す', () => {
        expect(serverImagePath('favicon', HASH)).toBe(`/api/v1/server/images/favicon/${HASH}.png`);
        expect(serverImagePath('banner', HASH)).toBe(`/api/v1/server/images/banner/${HASH}.webp`);
        expect(serverImageHashOf('favicon', `${HASH}.png`)).toBe(HASH);
        expect(serverImageHashOf('favicon', `${HASH}.webp`)).toBeNull();
        expect(serverImageHashOf('banner', `${HASH}.png`)).toBeNull();
        expect(serverImageHashOf('banner', `../${HASH.slice(3)}.webp`)).toBeNull();
        expect(serverImageHashOf('banner', '.webp')).toBeNull();
    });
});

describe('serverBrandingImages', () => {
    const all = ['favicon', 'apple-touch-icon', 'icon-192', 'icon-512'].map((variant) => ({ variant, hash: HASH }));

    it('絶対 URL にする（基点の末尾の / は重ねない）', () => {
        const images = serverBrandingImages([...all, { variant: 'banner', hash: HASH }], 'https://ubi.example/');
        expect(images.icon?.icon512).toBe(`https://ubi.example/api/v1/server/images/icon-512/${HASH}.png`);
        expect(images.banner).toBe(`https://ubi.example/api/v1/server/images/banner/${HASH}.webp`);
    });

    it('アイコンは作るものがそろっていなければ出さない（置き換えの途中・古い版の残り）', () => {
        expect(serverBrandingImages(all.slice(1), 'https://ubi.example').icon).toBeNull();
    });

    it('知らない種類の行は無視する', () => {
        expect(serverBrandingImages([{ variant: 'icon-48', hash: HASH }], 'https://ubi.example')).toEqual({
            icon: null,
            banner: null,
        });
    });
});
