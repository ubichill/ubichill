/** 画像の読み書き（実装は sharp）。判定の手順（processImage）から切り離し、偽物に差し替えて確かめられるようにする。 */

/** ヘッダから読んだ情報（向きの補正前の画素数）。 */
export interface ImageProbe {
    /** 読み取った形式（jpeg / png / webp / gif / heif …） */
    format: string;
    width: number;
    height: number;
}

export interface RenderedImage {
    bytes: Uint8Array;
    width: number;
    height: number;
}

export interface ImageCodec {
    /** ヘッダだけを読む。画像として読めなければ null。 */
    probe(input: Uint8Array): Promise<ImageProbe | null>;
    /**
     * EXIF の向きを反映し、指定の大きさに cover で切り抜いて WebP にする。メタデータ（EXIF・ICC・XMP）は残さない。
     * 動く画像は最初のコマだけ使う。読めなければ例外。
     */
    render(input: Uint8Array, size: { width: number; height: number }): Promise<RenderedImage>;
}
