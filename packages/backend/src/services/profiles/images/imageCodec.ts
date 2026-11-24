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

export interface RenderTarget {
    width: number;
    height: number;
    /** cover（既定）なら指定の大きさに切り抜き、inside なら縦横比を保って収める（小さい画像は大きくしない） */
    fit?: 'cover' | 'inside';
    /** 既定は WebP。PNG は WebP を読めない使い道（Safari の favicon・iOS のホーム画面）のため */
    format?: 'webp' | 'png';
    /** 透明な部分をこの色（`#rrggbb`）で塗る */
    background?: string;
}

export interface ImageCodec {
    /** ヘッダだけを読む。画像として読めなければ null。 */
    probe(input: Uint8Array): Promise<ImageProbe | null>;
    /**
     * EXIF の向きを反映して指定の大きさ・形式にする。メタデータ（EXIF・ICC・XMP）は残さない。動く画像は最初のコマだけ使う。
     * 読めなければ例外。
     */
    render(input: Uint8Array, target: RenderTarget): Promise<RenderedImage>;
}
