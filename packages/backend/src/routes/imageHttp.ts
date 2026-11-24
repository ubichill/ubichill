/** 画像を受け取る・配る route の共通の形（プロフィール画像・ワールドの画像・サーバーのアイコン）。 */
import express, { type ErrorRequestHandler, type RequestHandler, type Response } from 'express';

/** 内容のハッシュ入りの URL なので、同じ URL の中身は変わらない */
const IMMUTABLE = 'public, max-age=31536000, immutable';
/** 画像の URL を直接開かれても、文書として何も実行させない */
const IMAGE_CSP = "default-src 'none'; style-src 'unsafe-inline'; sandbox";
const MB = 1024 * 1024;

/** 本文（image/* のバイト列）を Buffer で受け取る */
export const readImageBody = (maxBytes: number): RequestHandler => express.raw({ type: 'image/*', limit: maxBytes });

/** 本文を受け取れなかったとき（大きすぎる・壊れている）の応答。router の最後に置く */
export const imageBodyErrors =
    (maxBytes: number): ErrorRequestHandler =>
    (err: unknown, _req, res, next) => {
        const type = typeof err === 'object' && err !== null && 'type' in err ? err.type : undefined;
        if (type === 'entity.too.large') {
            res.status(413).json({ error: `画像は ${maxBytes / MB} MB までです`, code: 'too-large' });
            return;
        }
        if (typeof type === 'string') {
            res.status(400).json({ error: '画像を受け取れませんでした', code: 'invalid' });
            return;
        }
        next(err);
    };

/** 見つからない画像。同じ内容をまた上げれば同じ URL が有効に戻るので、cache させない */
export const sendImageNotFound = (res: Response): void => {
    res.status(404).set('Cache-Control', 'no-store').json({ error: 'Not found' });
};

/** ハッシュ入りの URL の画像を配る（長く cache させる） */
export function sendImage(res: Response, image: { hash: string; bytes: Uint8Array }, contentType: string): void {
    res.set({
        'Content-Type': contentType,
        'Cache-Control': IMMUTABLE,
        ETag: `"${image.hash}"`,
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': IMAGE_CSP,
        // ほかのオリジン（開発時のフロント・連合先のサーバー）の <img> からも読めるようにする
        'Cross-Origin-Resource-Policy': 'cross-origin',
    });
    res.send(Buffer.from(image.bytes.buffer, image.bytes.byteOffset, image.bytes.byteLength));
}
