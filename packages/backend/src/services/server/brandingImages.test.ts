import { PROFILE_IMAGE_MAX_BYTES, PROFILE_IMAGE_MAX_PIXELS } from '@ubichill/shared';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import type { ImageCodec } from '../profiles/images/imageCodec';
import { createSharpCodec } from '../profiles/images/sharpCodec';
import { processServerImage } from './brandingImages';

const LIMITS = { maxBytes: PROFILE_IMAGE_MAX_BYTES, maxPixels: PROFILE_IMAGE_MAX_PIXELS };
const codec = createSharpCodec({ maxPixels: PROFILE_IMAGE_MAX_PIXELS, timeoutSeconds: 10 });

/** 真ん中だけ不透明な赤の、まわりが透明な PNG */
const transparentPng = (width: number, height: number) =>
    sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
        .composite([
            {
                input: {
                    create: {
                        width: Math.floor(width / 2),
                        height: Math.floor(height / 2),
                        channels: 4,
                        background: '#ff0000',
                    },
                },
                gravity: 'centre',
            },
        ])
        .png()
        .toBuffer();

const processed = async (kind: 'icon' | 'banner', input: Uint8Array, using: ImageCodec = codec) => {
    const result = await processServerImage(kind, input, using, LIMITS);
    if (!result.ok) throw new Error(`作り直せなかった: ${result.code}`);
    return new Map(result.images.map((image) => [image.variant, image]));
};

describe('processServerImage（sharp で作り直す）', () => {
    it('アイコンは正方形に切り抜き、タブ・iOS・PWA の大きさの PNG を作る', async () => {
        const images = await processed('icon', await transparentPng(900, 600));
        expect([...images.keys()].sort()).toEqual(['apple-touch-icon', 'favicon', 'icon-192', 'icon-512']);
        for (const [variant, size] of [
            ['favicon', 32],
            ['apple-touch-icon', 180],
            ['icon-192', 192],
            ['icon-512', 512],
        ] as const) {
            const image = images.get(variant);
            expect(image?.contentType, variant).toBe('image/png');
            expect(await sharp(image?.bytes).metadata(), variant).toMatchObject({
                format: 'png',
                width: size,
                height: size,
            });
            expect({ width: image?.width, height: image?.height }).toEqual({ width: size, height: size });
        }
        // 同じ中身は同じハッシュ、違う大きさは違うハッシュ
        expect(new Set([...images.values()].map((image) => image.hash)).size).toBe(4);
    });

    it('iOS のホーム画面のアイコンは透明な部分を白で塗り、ほかは透明のまま残す', async () => {
        const images = await processed('icon', await transparentPng(400, 400));
        const corner = async (bytes: Uint8Array | undefined) => {
            const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
            return { r: data[0], g: data[1], b: data[2], a: data[info.channels - 1] };
        };
        expect(await corner(images.get('apple-touch-icon')?.bytes)).toEqual({ r: 255, g: 255, b: 255, a: 255 });
        expect((await corner(images.get('icon-512')?.bytes)).a).toBe(0);
    });

    it('バナーは 1200×630 の WebP にする', async () => {
        const images = await processed('banner', await transparentPng(3000, 1000));
        const banner = images.get('banner');
        expect(images.size).toBe(1);
        expect(banner?.contentType).toBe('image/webp');
        expect(await sharp(banner?.bytes).metadata()).toMatchObject({ format: 'webp', width: 1200, height: 630 });
    });

    it('EXIF（位置・作者）を残さない', async () => {
        const jpeg = await sharp({ create: { width: 300, height: 300, channels: 3, background: '#336699' } })
            .jpeg()
            .withExif({ IFD0: { Artist: 'secret-artist' } })
            .toBuffer();
        for (const image of (await processed('icon', jpeg)).values()) {
            const meta = await sharp(image.bytes).metadata();
            expect(meta.exif, image.variant).toBeUndefined();
            expect(Buffer.from(image.bytes).includes('secret-artist')).toBe(false);
        }
    });

    it('送られた画像を読むのは 1 回だけで、小さいものは作り直した画像から縮める', async () => {
        const input = await transparentPng(600, 600);
        const rendered: Uint8Array[] = [];
        const spy: ImageCodec = {
            probe: (bytes) => codec.probe(bytes),
            render: (bytes, target) => {
                rendered.push(bytes);
                return codec.render(bytes, target);
            },
        };
        await processed('icon', input, spy);
        expect(rendered).toHaveLength(4);
        expect(rendered.filter((bytes) => bytes === input)).toHaveLength(1);
    });

    it('SVG・読めないもの・画素の多すぎる画像は断る', async () => {
        const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>');
        expect(await processServerImage('icon', svg, codec, LIMITS)).toMatchObject({ ok: false, code: 'unsupported' });
        expect(await processServerImage('icon', Buffer.from('not an image'), codec, LIMITS)).toMatchObject({
            ok: false,
            code: 'undecodable',
        });
        expect(
            await processServerImage('banner', await transparentPng(100, 100), codec, { ...LIMITS, maxPixels: 50 }),
        ).toMatchObject({ ok: false, code: 'too-many-pixels' });
    });

    it('縮める途中で失敗したら、一部だけ置かずに全部を断る', async () => {
        const failing: ImageCodec = {
            probe: (bytes) => codec.probe(bytes),
            render: async (bytes, target) => {
                if (target.width < 512) throw new Error('boom');
                return codec.render(bytes, target);
            },
        };
        expect(await processServerImage('icon', await transparentPng(100, 100), failing, LIMITS)).toMatchObject({
            ok: false,
            code: 'undecodable',
        });
    });
});
