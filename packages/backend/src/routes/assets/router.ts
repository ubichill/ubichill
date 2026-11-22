import { WORLD_ASSET_CONTENT_TYPE, WORLD_ASSET_MAX_BYTES, worldAssetHashOf } from '@ubichill/shared';
import express, { type ErrorRequestHandler, type RequestHandler, Router } from 'express';
import type { WorldAssetService } from '../../services/worldAssets/worldAssets';

export interface AssetsRouterDeps {
    requireAuth: RequestHandler;
    /** 画像のアップロード・削除（作り直しが重いので絞る） */
    uploadLimiter: RequestHandler;
    assets: Pick<WorldAssetService, 'upload' | 'list' | 'remove' | 'image'>;
}

/** 内容のハッシュ入りの URL なので、同じ URL の中身は変わらない */
const IMMUTABLE = 'public, max-age=31536000, immutable';
/** 画像の URL を直接開かれても、文書として何も実行させない */
const IMAGE_CSP = "default-src 'none'; style-src 'unsafe-inline'; sandbox";
const MB = 1024 * 1024;

const readImageBody = express.raw({ type: 'image/*', limit: WORLD_ASSET_MAX_BYTES });

const bodyErrors: ErrorRequestHandler = (err: unknown, _req, res, next) => {
    const type = typeof err === 'object' && err !== null && 'type' in err ? err.type : undefined;
    if (type === 'entity.too.large') {
        res.status(413).json({ error: `画像は ${WORLD_ASSET_MAX_BYTES / MB} MB までです`, code: 'too-large' });
        return;
    }
    if (typeof type === 'string') {
        res.status(400).json({ error: '画像を受け取れませんでした', code: 'invalid' });
        return;
    }
    next(err);
};

/**
 * ワールドの画像（`/api/v1/assets`）。
 * - `POST /`: 画像（本文は image/* のバイト列）を作り直して置く。応答は置いた画像（201）
 * - `GET /`: 自分が上げた画像と、使っている量
 * - `DELETE /:hash.webp`: 自分が上げた画像を消す
 * - `GET /:hash.webp`: 配信（ハッシュ入りの URL なので長く cache させる。ログインしなくても読める）
 */
export function createAssetsRouter(deps: AssetsRouterDeps): Router {
    const router = Router();

    router.post('/', deps.requireAuth, deps.uploadLimiter, readImageBody, async (req, res) => {
        if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
        if (!Buffer.isBuffer(req.body)) {
            return res.status(415).json({ error: '画像を送ってください', code: 'unsupported' });
        }
        const outcome = await deps.assets.upload(req.user.id, new Uint8Array(req.body));
        res.set('Cache-Control', 'no-store');
        if (!outcome.ok) return res.status(outcome.status).json({ error: outcome.error, code: outcome.code });
        return res.status(201).json(outcome.value);
    });

    router.get('/', deps.requireAuth, async (req, res) => {
        if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
        res.set('Cache-Control', 'no-store').json(await deps.assets.list(req.user.id));
    });

    router.delete('/:file', deps.requireAuth, deps.uploadLimiter, async (req, res) => {
        if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
        const hash = worldAssetHashOf(String(req.params.file));
        if (!hash) return res.status(404).json({ error: '画像が見つかりません', code: 'not-found' });
        const outcome = await deps.assets.remove(req.user.id, hash);
        res.set('Cache-Control', 'no-store');
        if (!outcome.ok) return res.status(outcome.status).json({ error: outcome.error, code: outcome.code });
        return res.status(204).send();
    });

    router.get('/:file', async (req, res) => {
        const hash = worldAssetHashOf(String(req.params.file));
        const image = hash ? await deps.assets.image(hash) : undefined;
        if (!image) {
            // 同じ内容をまた上げれば同じ URL が有効に戻るので、見つからないことは cache させない
            return res.status(404).set('Cache-Control', 'no-store').json({ error: 'Not found' });
        }
        res.set({
            'Content-Type': WORLD_ASSET_CONTENT_TYPE,
            'Cache-Control': IMMUTABLE,
            ETag: `"${image.hash}"`,
            'X-Content-Type-Options': 'nosniff',
            'Content-Security-Policy': IMAGE_CSP,
            // ほかのオリジン（開発時のフロント・連合先のサーバー）の <img> からも読めるようにする
            'Cross-Origin-Resource-Policy': 'cross-origin',
        });
        // ほかのサーバーのエディタがサムネイルを撮るとき（画像を読み直して描く）にも読めるようにする。
        // このサーバーのフロントには cors() が付けた許可（cookie 付き）をそのまま返す
        if (!res.getHeader('Access-Control-Allow-Origin')) res.set('Access-Control-Allow-Origin', '*');
        res.send(Buffer.from(image.bytes.buffer, image.bytes.byteOffset, image.bytes.byteLength));
    });

    router.use(bodyErrors);
    return router;
}
