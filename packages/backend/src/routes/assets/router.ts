import { WORLD_ASSET_CONTENT_TYPE, WORLD_ASSET_MAX_BYTES, worldAssetHashOf } from '@ubichill/shared';
import { type RequestHandler, Router } from 'express';
import type { WorldAssetService } from '../../services/worldAssets/worldAssets';
import { imageBodyErrors, readImageBody, sendImage, sendImageNotFound } from '../imageHttp';

export interface AssetsRouterDeps {
    requireAuth: RequestHandler;
    /** 画像のアップロード（作り直しが重いので絞る） */
    uploadLimiter: RequestHandler;
    /** 消す（アップロードとは別に数える） */
    deleteLimiter: RequestHandler;
    assets: Pick<WorldAssetService, 'upload' | 'remove' | 'image'>;
}

/**
 * ワールドの画像（`/api/v1/assets`）。
 * - `POST /`: 画像（本文は image/* のバイト列）を作り直して置く。応答は置いた画像（201）
 * - `DELETE /:hash.webp`: 自分が上げた画像を消す（一覧は `GET /api/v1/users/me/storage`）
 * - `GET /:hash.webp`: 配信（ハッシュ入りの URL なので長く cache させる。ログインしなくても読める）
 */
export function createAssetsRouter(deps: AssetsRouterDeps): Router {
    const router = Router();

    router.post('/', deps.requireAuth, deps.uploadLimiter, readImageBody(WORLD_ASSET_MAX_BYTES), async (req, res) => {
        if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
        if (!Buffer.isBuffer(req.body)) {
            return res.status(415).json({ error: '画像を送ってください', code: 'unsupported' });
        }
        const outcome = await deps.assets.upload(req.user.id, new Uint8Array(req.body));
        res.set('Cache-Control', 'no-store');
        if (!outcome.ok) return res.status(outcome.status).json({ error: outcome.error, code: outcome.code });
        return res.status(201).json(outcome.value);
    });

    router.delete('/:file', deps.requireAuth, deps.deleteLimiter, async (req, res) => {
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
        if (!image) return sendImageNotFound(res);
        // ほかのサーバーのエディタがサムネイルを撮るとき（画像を読み直して描く）にも読めるようにする。
        // このサーバーのフロントには cors() が付けた許可（cookie 付き）をそのまま返す
        if (!res.getHeader('Access-Control-Allow-Origin')) res.set('Access-Control-Allow-Origin', '*');
        sendImage(res, image, WORLD_ASSET_CONTENT_TYPE);
    });

    router.use(imageBodyErrors(WORLD_ASSET_MAX_BYTES));
    return router;
}
