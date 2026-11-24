import { isServerImageVariant, type ServerOverview, serverImageContentType, serverImageHashOf } from '@ubichill/shared';
import { Router } from 'express';
import { sendImage, sendImageNotFound } from '../imageHttp';

export interface ServerRouterDeps {
    overview(): Promise<ServerOverview>;
    image(variant: string, hash: string): Promise<{ hash: string; bytes: Uint8Array } | undefined>;
    /** 検索に出してよい人（sitemap に載せる） */
    directory(): Promise<Array<{ handle: string; updatedAt: Date }>>;
}

/**
 * サーバーの情報（`/api/v1/server`。ログインしなくても読める）。
 * - `GET /`: 紹介のページ・画面の色とアイコン・BFF の <head> に使うもの（情報・ブランディング・新規登録を受け付けているか・人数）
 * - `GET /images/:variant/:hash.(png|webp)`: アイコン・バナーの配信（ハッシュ入りの URL なので長く cache させる）
 * - `GET /directory`: 検索に出してよい人の ID と更新した時刻（BFF の sitemap.xml）
 */
export function createServerRouter(deps: ServerRouterDeps): Router {
    const router = Router();

    // 管理者が変えたらすぐ出るよう、毎回確かめさせる（変わっていなければ ETag で 304）
    router.get('/', async (_req, res) => {
        res.set('Cache-Control', 'no-cache').json(await deps.overview());
    });

    router.get('/images/:variant/:file', async (req, res) => {
        const { variant, file } = req.params;
        if (!isServerImageVariant(variant)) return sendImageNotFound(res);
        const hash = serverImageHashOf(variant, file);
        const image = hash ? await deps.image(variant, hash) : undefined;
        if (!image) return sendImageNotFound(res);
        sendImage(res, image, serverImageContentType(variant));
    });

    router.get('/directory', async (_req, res) => {
        const users = await deps.directory();
        res.set('Cache-Control', 'public, max-age=600').json({
            users: users.map((user) => ({ handle: user.handle, updatedAt: user.updatedAt.toISOString() })),
        });
    });

    return router;
}
