import sharp from 'sharp';
import type { ImageCodec } from './imageCodec';

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
            const { data, info } = await sharp(input, {
                limitInputPixels: maxPixels,
                failOn: 'warning',
                autoOrient: true,
                pages: 1,
            })
                .resize(size.width, size.height, { fit: 'cover', position: 'centre' })
                .webp({ quality: 82 })
                .timeout({ seconds: timeoutSeconds })
                .toBuffer({ resolveWithObject: true });
            return {
                bytes: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
                width: info.width,
                height: info.height,
            };
        },
    };
}
