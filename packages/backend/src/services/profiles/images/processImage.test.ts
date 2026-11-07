import { crc32 } from 'node:zlib';
import { PROFILE_IMAGE_MAX_PIXELS, PROFILE_IMAGE_SIZES } from '@ubichill/shared';
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import type { ImageCodec } from './imageCodec';
import { imageHashOf, processProfileImage } from './processImage';
import { createSharpCodec } from './sharpCodec';

const codec = createSharpCodec({ maxPixels: PROFILE_IMAGE_MAX_PIXELS, timeoutSeconds: 10 });

/** 上半分が赤・下半分が青の画像（保存されたままの向き）。 */
async function halfRedHalfBlue(width: number, height: number): Promise<Buffer> {
    const raw = Buffer.alloc(width * height * 3);
    for (const i of Array.from({ length: width * height }, (_, n) => n)) {
        raw[i * 3 + (Math.floor(i / width) < height / 2 ? 0 : 2)] = 255;
    }
    return sharp(raw, { raw: { width, height, channels: 3 } })
        .png()
        .toBuffer();
}

const solid = (color: string, width = 40, height = 40) =>
    sharp({ create: { width, height, channels: 3, background: color } })
        .png()
        .toBuffer();

async function pixelAt(webp: Uint8Array, x: number, y: number): Promise<{ r: number; g: number; b: number }> {
    const { data, info } = await sharp(webp).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const i = (y * info.width + x) * 3;
    return { r: data[i], g: data[i + 1], b: data[i + 2] };
}

const processed = async (input: Uint8Array, kind: 'avatar' | 'banner' = 'avatar') => {
    const result = await processProfileImage(input, kind, codec);
    if (!result.ok) throw new Error(`作り直せなかった: ${result.code}`);
    return result.image;
};

describe('processProfileImage（sharp で作り直す）', () => {
    it('決まった大きさの WebP にする（アイコンは正方形・バナーは 3:1、cover で切り抜く）', async () => {
        const input = await solid('#336699', 800, 300);
        const avatar = await processed(input, 'avatar');
        const banner = await processed(input, 'banner');
        expect(avatar.contentType).toBe('image/webp');
        expect(await sharp(avatar.bytes).metadata()).toMatchObject({ format: 'webp', ...PROFILE_IMAGE_SIZES.avatar });
        expect(await sharp(banner.bytes).metadata()).toMatchObject({ format: 'webp', ...PROFILE_IMAGE_SIZES.banner });
        expect({ width: banner.width, height: banner.height }).toEqual(PROFILE_IMAGE_SIZES.banner);
    });

    it('EXIF の向きを反映してから、EXIF（著作者・位置などを含む）を消す', async () => {
        // 横長に保存し、向き 6（時計回りに 90°）で縦長に見せる。上の赤は右、下の青は左に来る
        const stored = await sharp(await halfRedHalfBlue(60, 20))
            .jpeg()
            .withExif({ IFD0: { Artist: 'secret-artist', Copyright: 'secret' } })
            .withMetadata({ orientation: 6 })
            .toBuffer();
        expect((await sharp(stored).metadata()).orientation).toBe(6);

        const avatar = await processed(stored);
        const meta = await sharp(avatar.bytes).metadata();
        expect(meta.orientation).toBeUndefined();
        expect(meta.exif).toBeUndefined();
        expect(meta.icc).toBeUndefined();
        expect(meta.xmp).toBeUndefined();
        expect(Buffer.from(avatar.bytes).includes('secret-artist')).toBe(false);
        const left = await pixelAt(avatar.bytes, 60, 256);
        const right = await pixelAt(avatar.bytes, 450, 256);
        expect(left.b).toBeGreaterThan(200);
        expect(left.r).toBeLessThan(60);
        expect(right.r).toBeGreaterThan(200);
        expect(right.b).toBeLessThan(60);
    });

    it('動く画像（GIF・WebP）は最初のコマだけの静止画にする', async () => {
        const frames = [await solid('#ff0000'), await solid('#0000ff')];
        for (const animated of [
            await sharp(frames, { join: { animated: true } })
                .gif()
                .toBuffer(),
            await sharp(frames, { join: { animated: true } })
                .webp()
                .toBuffer(),
        ]) {
            expect((await sharp(animated).metadata()).pages).toBe(2);
            const avatar = await processed(animated);
            const meta = await sharp(avatar.bytes).metadata();
            expect(meta.pages ?? 1).toBe(1);
            expect(meta.height).toBe(PROFILE_IMAGE_SIZES.avatar.height);
            const center = await pixelAt(avatar.bytes, 256, 256);
            expect(center.r).toBeGreaterThan(200);
            expect(center.b).toBeLessThan(60);
        }
    });

    it('同じ内容なら同じハッシュ、違えば違うハッシュ（URL に入れて置き換えを見分ける）', async () => {
        const a = await processed(await solid('#112233'));
        const b = await processed(await solid('#112233'));
        const c = await processed(await solid('#332211'));
        expect(a.hash).toBe(b.hash);
        expect(a.hash).not.toBe(c.hash);
        expect(a.hash).toBe(imageHashOf(a.bytes));
        expect(a.hash).toMatch(/^[A-Za-z0-9_-]{43}$/);
    });

    it('画像でないもの・SVG・壊れた画像は断る', async () => {
        const svg = Buffer.from(
            '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><image href="https://evil.example/x.png"/></svg>',
        );
        const jpeg = await sharp(await solid('#808080', 200, 200))
            .jpeg()
            .toBuffer();
        expect(await processProfileImage(Buffer.from('hello, not an image'), 'avatar', codec)).toMatchObject({
            ok: false,
            code: 'undecodable',
        });
        expect(
            await processProfileImage(Buffer.from('<html><script>alert(1)</script>'), 'avatar', codec),
        ).toMatchObject({
            ok: false,
        });
        expect(await processProfileImage(svg, 'avatar', codec)).toMatchObject({ ok: false, code: 'unsupported' });
        expect(await processProfileImage(jpeg.subarray(0, jpeg.length - 200), 'avatar', codec)).toMatchObject({
            ok: false,
            code: 'undecodable',
        });
    });

    it('小さなファイルで巨大な画素数を名乗る画像（展開爆弾）は、展開する前に断る', async () => {
        const png = Buffer.from(await solid('#000000', 1, 1));
        // IHDR の幅・高さを 100000 × 100000 に書き換え、CRC を合わせる
        png.writeUInt32BE(100_000, 16);
        png.writeUInt32BE(100_000, 20);
        png.writeUInt32BE(crc32(png.subarray(12, 29)), 29);
        expect(png.byteLength).toBeLessThan(200);
        expect(await processProfileImage(png, 'avatar', codec)).toMatchObject({ ok: false, code: 'too-many-pixels' });
    });

    it('ヘッダの確認をすり抜けても、展開の途中で画素数の上限で止める', async () => {
        const strict = createSharpCodec({ maxPixels: 100, timeoutSeconds: 10 });
        await expect(strict.render(await solid('#000000', 20, 20), PROFILE_IMAGE_SIZES.avatar)).rejects.toThrow();
    });
});

describe('processProfileImage（判定の手順）', () => {
    const fakeCodec = (overrides: Partial<ImageCodec> = {}): ImageCodec => ({
        probe: vi.fn(async () => ({ format: 'png', width: 10, height: 10 })),
        render: vi.fn(async () => ({ bytes: new Uint8Array([1, 2, 3]), width: 512, height: 512 })),
        ...overrides,
    });

    it('空・大きすぎる入力は、読み込みを始める前に断る', async () => {
        const fake = fakeCodec();
        expect(await processProfileImage(new Uint8Array(), 'avatar', fake)).toMatchObject({ ok: false, code: 'empty' });
        expect(
            await processProfileImage(new Uint8Array(11), 'avatar', fake, { maxBytes: 10, maxPixels: 100 }),
        ).toMatchObject({ ok: false, code: 'too-large' });
        expect(fake.probe).not.toHaveBeenCalled();
    });

    it('上限ちょうどは通す', async () => {
        const fake = fakeCodec();
        expect(
            await processProfileImage(new Uint8Array(10), 'avatar', fake, { maxBytes: 10, maxPixels: 100 }),
        ).toMatchObject({ ok: true });
    });

    it('受け付けない形式・画素数の多すぎる画像は、作り直す前に断る', async () => {
        for (const format of ['svg', 'tiff', 'pdf', 'raw', 'magick']) {
            const fake = fakeCodec({ probe: async () => ({ format, width: 10, height: 10 }) });
            expect(await processProfileImage(new Uint8Array(4), 'avatar', fake)).toMatchObject({ code: 'unsupported' });
            expect(fake.render).not.toHaveBeenCalled();
        }
        const huge = fakeCodec({ probe: async () => ({ format: 'jpeg', width: 10_001, height: 10_000 }) });
        expect(
            await processProfileImage(new Uint8Array(4), 'avatar', huge, { maxBytes: 10, maxPixels: 100_000_000 }),
        ).toMatchObject({ code: 'too-many-pixels' });
        expect(huge.render).not.toHaveBeenCalled();
    });

    it('作り直しに失敗したら（壊れた画像・時間切れ）理由つきで断る', async () => {
        const fake = fakeCodec({ render: async () => Promise.reject(new Error('VipsJpeg: premature end')) });
        expect(await processProfileImage(new Uint8Array(4), 'banner', fake)).toMatchObject({
            ok: false,
            code: 'undecodable',
        });
    });

    it('種類ごとの大きさで作り直させる', async () => {
        const fake = fakeCodec();
        await processProfileImage(new Uint8Array(4), 'banner', fake);
        expect(fake.render).toHaveBeenCalledWith(expect.any(Uint8Array), PROFILE_IMAGE_SIZES.banner);
    });
});
