import sharp, { type WebpOptions } from 'sharp';
import type { ImageCodec } from './imageCodec';
import { LOSSLESS_WEBP, LOSSY_WEBP, prefersLossless, triesLossless } from './webpEncoding';

interface SharpCodecOptions {
    /** 展開してよい画素数の上限（ヘッダを偽った画像も展開の途中で止める） */
    maxPixels: number;
    /** 1 枚の処理にかけてよい秒数 */
    timeoutSeconds: number;
}

/** sharp（libvips）による実装。 */
export function createSharpCodec({ maxPixels, timeoutSeconds }: SharpCodecOptions): ImageCodec {
    // 長く動くサーバーで、処理した画像の中間結果をメモリに持ち続けない
    sharp.cache(false);
    return {
        async probe(input) {
            try {
                // ヘッダだけを読むので画素数の上限はここでは掛けない（上限を超えたことを理由つきで返すため）
                const meta = await sharp(input, { limitInputPixels: false }).metadata();
                return meta.width && meta.height
                    ? { format: meta.format, width: meta.width, height: meta.height }
                    : null;
            } catch {
                return null;
            }
        },
        async render(input, size) {
            const resized = sharp(input, {
                limitInputPixels: maxPixels,
                failOn: 'warning',
                autoOrient: true,
                pages: 1,
            })
                .resize(
                    size.width,
                    size.height,
                    size.fit === 'inside'
                        ? { fit: 'inside', withoutEnlargement: true }
                        : { fit: 'cover', position: 'centre' },
                )
                .timeout({ seconds: timeoutSeconds });
            const encode = (options: WebpOptions) =>
                resized.clone().webp(options).toBuffer({ resolveWithObject: true });
            const [{ format }, lossy] = await Promise.all([resized.metadata(), encode(LOSSY_WEBP)]);
            const lossless = triesLossless(format, {
                bytes: lossy.data.byteLength,
                width: lossy.info.width,
                height: lossy.info.height,
            })
                ? await encode(LOSSLESS_WEBP)
                : null;
            const { data, info } =
                lossless && prefersLossless(lossy.data.byteLength, lossless.data.byteLength) ? lossless : lossy;
            return {
                bytes: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
                width: info.width,
                height: info.height,
            };
        },
    };
}
