/** `GET /api/v1/server`: 紹介のページに出すサーバーの情報（ログインしなくても読める）。 */
import { Router } from 'express';
import { serverInfoService } from '../services/server/serverInfoService';

export const router = Router();

router.get('/', async (_req, res) => {
    // 管理者が変えたらすぐ出るよう、毎回確かめさせる（変わっていなければ ETag で 304）
    res.set('Cache-Control', 'no-cache').json(await serverInfoService.overview());
});
