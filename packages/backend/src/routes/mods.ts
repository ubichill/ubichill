import { type AuthorKeyCheck, ModLockEntrySchema, verifyModSignature, type WorldCrypto } from '@ubichill/shared';
import { Router } from 'express';
import { z } from 'zod';

const VerifyRequestSchema = z.object({ entry: ModLockEntrySchema, signature: z.unknown().optional() });

/**
 * POST /api/v1/mods/signature/verify（非推奨。移行期間だけ残す）
 *
 * 新しい Host はブラウザで確かめるので使わない。更新前のフロントを開いたままの利用者が mod を読み込めるよう、
 * 同じ shared の verifyModSignature と作者の確認の規則（authorKeyDirectory）に委ねて答える（規則を二重に持たない）。
 * 古いフロントが残っていないと判断できたら削除する（応答の Deprecation ヘッダーで知らせる）。
 */
export function createModsRouter(deps: { crypto: WorldCrypto; isAuthorKey: AuthorKeyCheck }): Router {
    const router = Router();
    router.post('/signature/verify', async (req, res) => {
        const parsed = VerifyRequestSchema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({ error: 'entry（mod の lock）と signature を指定してください' });
            return;
        }
        res.set('Cache-Control', 'no-store');
        res.set('Deprecation', 'true');
        res.json(await verifyModSignature(parsed.data.entry, parsed.data.signature, deps.crypto, deps.isAuthorKey));
    });
    return router;
}
