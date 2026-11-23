/**
 * 作り直すときの WebP の圧縮の選び方。
 * 写真は非可逆（quality 82・effort 4）。effort 6 は 2〜5% しか小さくならず、ドット絵では 100 倍近く遅くなるので使わない。
 * PNG・GIF のうち色の少ない絵（ドット絵・平らな絵）は可逆の方が小さく、縁もにじまない。スクリーンショット・写真・
 * 細かいノイズの入った PNG は可逆が 2〜10 倍になり、作るだけで 0.2〜1 秒かかる（エディタのサムネイルは毎回 PNG で来る）。
 * そこで、縮めた後の画素の色が 256 色以下のときだけ可逆も作る。
 */
import type { WebpOptions } from 'sharp';

export const LOSSY_WEBP: WebpOptions = { quality: 82 };
export const LOSSLESS_WEBP: WebpOptions = { lossless: true };
/**
 * 可逆を作るのにかけてよい秒数（越えたら非可逆を使う）。sharp の timeout は秒単位で数えるので、実際に止まるのは 1〜2 秒後。
 * 256 色以下なら 2048×2048 でも数十 ms で終わるので、ふつうは届かない。
 */
export const LOSSLESS_TIMEOUT_SECONDS = 1;

const LOSSLESS_CANDIDATES: ReadonlySet<string> = new Set(['png', 'gif']);
const MAX_PALETTE = 256;

/**
 * RGBA の画素の色（RGB）が max 色以下か（越えた時点でやめる）。透明度は数えない（判定の目安なので RGB で足りる）。
 * main thread で全画素を見るので、Set（数を箱に入れる）を使わず、24 ビットの RGB の印（2 MiB）と数の配列だけで数える
 * （2048×2048 を 1 回なめて数 ms。色が多ければすぐ抜ける）。
 */
export function hasFewColors(rgba: Uint8Array, max = MAX_PALETTE): boolean {
    // 4 バイトずつ数で読む（Int32Array は 4 の倍数の位置からしか作れないので、ずれていれば写す）
    const pixels =
        rgba.byteOffset % 4 === 0
            ? new Int32Array(rgba.buffer, rgba.byteOffset, Math.floor(rgba.byteLength / 4))
            : new Int32Array(rgba.slice().buffer, 0, Math.floor(rgba.byteLength / 4));
    const seen = new Uint8Array(1 << 21);
    const count = new Int32Array(1);
    for (const pixel of pixels) {
        // リトルエンディアンなので下の 24 ビットが RGB
        const rgb = pixel & 0xffffff;
        const mask = 1 << (rgb & 7);
        const at = rgb >>> 3;
        if ((seen[at] & mask) === 0) {
            seen[at] |= mask;
            count[0] += 1;
            if (count[0] > max) return false;
        }
    }
    return true;
}

/** 可逆も作るかもしれない形式（PNG・GIF）。ほかは縮めて非可逆にするだけ。 */
export const mayTryLossless = (format: string | undefined): boolean => !!format && LOSSLESS_CANDIDATES.has(format);

/** 可逆でも作ってみるか（PNG・GIF で、縮めた後が 256 色以下）。 */
export const triesLossless = (format: string | undefined, rgba: Uint8Array): boolean =>
    mayTryLossless(format) && hasFewColors(rgba);

/** 可逆が非可逆の 1.1 倍までなら可逆を選ぶ（少し大きくても、画素がずれない方を取る）。 */
export const prefersLossless = (lossyBytes: number, losslessBytes: number): boolean =>
    losslessBytes <= lossyBytes * 1.1;
