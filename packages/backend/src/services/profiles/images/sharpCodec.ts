import sharp, { type WebpOptions } from 'sharp';
import type { ImageCodec } from './imageCodec';
import {
    LOSSLESS_TIMEOUT_SECONDS,
    LOSSLESS_WEBP,
    LOSSY_WEBP,
    mayTryLossless,
    prefersLossless,
    triesLossless,
} from './webpEncoding';

const rendered = ({ data, info }: { data: Buffer; info: { width: number; height: number } }) => ({
    bytes: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
    width: info.width,
    height: info.height,
});

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
        async render(input, target) {
            const { format, hasAlpha } = await sharp(input, { limitInputPixels: false }).metadata();
            const opened = sharp(input, { limitInputPixels: maxPixels, failOn: 'warning', autoOrient: true, pages: 1 })
                .resize(
                    target.width,
                    target.height,
                    target.fit === 'inside'
                        ? { fit: 'inside', withoutEnlargement: true }
                        : { fit: 'cover', position: 'centre' },
                )
                .timeout({ seconds: timeoutSeconds });
            const resized = target.background ? opened.flatten({ background: target.background }) : opened;
            if (target.format === 'png') {
                return rendered(await resized.png({ compressionLevel: 9 }).toBuffer({ resolveWithObject: true }));
            }
            if (!mayTryLossless(format))
                return rendered(await resized.webp(LOSSY_WEBP).toBuffer({ resolveWithObject: true }));

            // 読み込みと縮小は 1 回だけ。縮めた画素（sRGB・RGBA）から非可逆と可逆を作る
            const decoded = await resized
                .toColourspace('srgb')
                .ensureAlpha()
                .raw({ depth: 'uchar' })
                .toBuffer({ resolveWithObject: true });
            const { width, height } = decoded.info;
            const encode = (options: WebpOptions, seconds: number) => {
                const pixels = sharp(decoded.data, { raw: { width, height, channels: 4 } });
                return (hasAlpha ? pixels : pixels.removeAlpha())
                    .webp(options)
                    .timeout({ seconds })
                    .toBuffer({ resolveWithObject: true });
            };
            const [lossy, lossless] = await Promise.all([
                encode(LOSSY_WEBP, timeoutSeconds),
                // 可逆が失敗・時間切れでも、アップロードは非可逆で通す
                triesLossless(format, decoded.data)
                    ? Promise.resolve()
                          .then(() => encode(LOSSLESS_WEBP, LOSSLESS_TIMEOUT_SECONDS))
                          .catch(() => null)
                    : null,
            ]);
            return rendered(
                lossless && prefersLossless(lossy.data.byteLength, lossless.data.byteLength) ? lossless : lossy,
            );
        },
    };
}
