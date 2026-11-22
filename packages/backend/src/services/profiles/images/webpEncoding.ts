/**
 * 作り直すときの WebP の圧縮の選び方。
 * 写真は非可逆（quality 82・effort 4）。effort 6 は 2〜5% しか小さくならず、ドット絵では 100 倍近く遅くなるので使わない。
 * PNG・GIF のうち平らな絵・ドット絵は可逆の方が小さく、縁もにじまない（ドット絵は 1/9〜1/30）。スクリーンショット・写真の PNG は
 * 可逆が 2〜10 倍になり、作るだけで 0.2〜0.9 秒かかる（エディタのサムネイルは毎回 PNG で来る）。そこで可逆も作るのは、
 * 小さい画像（すぐ作れる）か、非可逆の結果が軽い（平らな）ときだけにする。
 */
import type { WebpOptions } from 'sharp';

export const LOSSY_WEBP: WebpOptions = { quality: 82 };
export const LOSSLESS_WEBP: WebpOptions = { lossless: true };

const LOSSLESS_CANDIDATES: ReadonlySet<string> = new Set(['png', 'gif']);
/** これ以下の画素数なら、いつも可逆も作る（細かいドット絵を元の大きさで上げても可逆にする） */
const SMALL_PIXELS = 512 * 512;
/** 非可逆で 1 画素あたりこれ以下なら平らな絵とみる（実測: 平らな絵・ドット絵 0.007〜0.010、スクリーンショット 0.03〜、写真 0.1） */
const FLAT_BYTES_PER_PIXEL = 0.02;

/** 可逆でも作ってみるか。 */
export function triesLossless(
    format: string | undefined,
    lossy: { bytes: number; width: number; height: number },
): boolean {
    if (!format || !LOSSLESS_CANDIDATES.has(format)) return false;
    const pixels = lossy.width * lossy.height;
    return pixels <= SMALL_PIXELS || lossy.bytes <= pixels * FLAT_BYTES_PER_PIXEL;
}

/** 可逆が非可逆の 1.1 倍までなら可逆を選ぶ（少し大きくても、画素がずれない方を取る）。 */
export const prefersLossless = (lossyBytes: number, losslessBytes: number): boolean =>
    losslessBytes <= lossyBytes * 1.1;
