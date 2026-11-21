/** エディタの画面から撮るサムネイルの大きさ（16:9。一覧・入口・リンクのカードに出す）。 */
export const THUMBNAIL_WIDTH = 1280;
export const THUMBNAIL_HEIGHT = 720;

export interface ShotRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface ShotInsets {
    top: number;
    right: number;
    bottom: number;
    left: number;
}

/** 見えている範囲から insets を除いた中に収まる、いちばん大きい 16:9 の枠（余りの真ん中に置く）。入らなければ null。 */
export function thumbnailFrame(viewport: { width: number; height: number }, insets: ShotInsets): ShotRect | null {
    const availableWidth = viewport.width - insets.left - insets.right;
    const availableHeight = viewport.height - insets.top - insets.bottom;
    if (availableWidth < 16 || availableHeight < 9) return null;
    const width = Math.floor(Math.min(availableWidth, (availableHeight * THUMBNAIL_WIDTH) / THUMBNAIL_HEIGHT));
    const height = Math.floor((width * THUMBNAIL_HEIGHT) / THUMBNAIL_WIDTH);
    return {
        x: Math.round(insets.left + (availableWidth - width) / 2),
        y: Math.round(insets.top + (availableHeight - height) / 2),
        width,
        height,
    };
}

/** 枠を THUMBNAIL_WIDTH の幅で描き直す倍率（小さい画面でも、拡大した絵ではなく描き直した絵にする）。 */
export function shotScale(frame: ShotRect): number {
    return THUMBNAIL_WIDTH / frame.width;
}

/** 枠を、別の要素の左上からの位置に直す（枠を出す層と、撮る要素の位置の差）。 */
export function moveFrame(frame: ShotRect, from: { left: number; top: number }, to: { left: number; top: number }) {
    return { ...frame, x: frame.x + from.left - to.left, y: frame.y + from.top - to.top };
}

/** 写せなかった画像（CORS で読めないほかのサーバーの画像）の知らせ。無ければ null。 */
export function missingImagesNotice(count: number): string | null {
    return count > 0
        ? `画像 ${count} 枚は、置いてあるサーバーが読ませないので写せませんでした（サムネイルではその部分が空きます）`
        : null;
}

/** 決めた時間で諦める（画像や動画の読み込みが返ってこないときに、撮る画面から出られなくしない）。 */
export function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(message)), ms);
        promise.then(
            (value) => {
                clearTimeout(timer);
                resolve(value);
            },
            (error: unknown) => {
                clearTimeout(timer);
                reject(error);
            },
        );
    });
}
