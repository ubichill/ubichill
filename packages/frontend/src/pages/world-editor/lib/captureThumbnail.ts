import { type ShotRect, shotScale, THUMBNAIL_HEIGHT, THUMBNAIL_WIDTH, withTimeout } from './thumbnailShot';

const TRANSPARENT_PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const SHOT_TIMEOUT_MS = 30_000;

export interface ThumbnailShot {
    file: File;
    /** 読めずに空けた画像の数 */
    missingImages: number;
}

/**
 * element の見えている範囲のうち frame（element の左上からの位置）を、サムネイルの大きさの PNG にする。
 * DOM を描き直して撮るので、mod の UI（shadow DOM・canvas）も写る。ほかのサーバーの画像は CORS で読めるものだけ写る。
 */
export async function captureThumbnail(element: HTMLElement, frame: ShotRect): Promise<ThumbnailShot> {
    const { domToCanvas } = await import('modern-screenshot');
    const scale = shotScale(frame);
    const missing = { count: 0 };
    const source = await withTimeout(
        domToCanvas(element, {
            scale,
            // スクロールした位置のまま写し、スクロールバーは写さない
            features: { restoreScrollPosition: true, copyScrollbar: false },
            style: { overflow: 'hidden' },
            timeout: SHOT_TIMEOUT_MS / 2,
            fetch: {
                placeholderImage: () => {
                    missing.count += 1;
                    return TRANSPARENT_PIXEL;
                },
            },
        }),
        SHOT_TIMEOUT_MS,
        '撮れませんでした（画像や動画の読み込みに時間がかかりすぎました）',
    );
    const canvas = document.createElement('canvas');
    canvas.width = THUMBNAIL_WIDTH;
    canvas.height = THUMBNAIL_HEIGHT;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('撮れませんでした（このブラウザでは画像を作れません）');
    context.drawImage(
        source,
        frame.x * scale,
        frame.y * scale,
        frame.width * scale,
        frame.height * scale,
        0,
        0,
        THUMBNAIL_WIDTH,
        THUMBNAIL_HEIGHT,
    );
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('撮れませんでした（画像を作れませんでした）');
    return {
        file: new File([blob], 'thumbnail.png', { type: 'image/png' }),
        missingImages: missing.count,
    };
}
