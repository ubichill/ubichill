import { type AuthorKeyCheck, ModLockEntrySchema, verifyModSignature, type WorldCrypto } from '@ubichill/shared';
import { Router } from 'express';
import { z } from 'zod';

const VerifyRequestSchema = z.object({ entry: ModLockEntrySchema, signature: z.unknown().optional() });

/**
 * POST /api/v1/mods/signature/verify
 *
 * mod の作者署名を確かめる（Host が mod を実行する前に呼ぶ。ゲストも mod を読み込むのでログイン不要）。
 * 署名の照合に加えて、署名鍵が作者の有効な鍵かをワールドの署名と同じ規則で確認する（他サーバーの作者は WebFinger）。
 * 署名を先に照合するので、署名を持たない依頼で他サーバーへの問い合わせ・確認済みの記録は起きない。
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
        res.json(await verifyModSignature(parsed.data.entry, parsed.data.signature, deps.crypto, deps.isAuthorKey));
    });
    return router;
}
