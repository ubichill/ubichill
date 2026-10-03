import { publishingEnvironmentRepository, userRepository } from '@ubichill/db';
import { HANDLE_PATTERN } from '@ubichill/shared';
import { Router } from 'express';
import { selfAccount } from '../services/authorKeys';
import { signingKeyListOf } from '../services/publishingEnvironments';
import { worldRegistry } from '../services/worldRegistry';

/**
 * GET /api/v1/authors/:handle/signing-keys
 *
 * このサーバーの作者アカウントの公開環境の鍵一覧（WebFinger の links から辿る）。ほかのサーバーはこれで
 * 署名鍵がその作者の有効な鍵かを確かめる。取り消した鍵も revokedAt 付きで返す。公開情報のみ。
 */
const router = Router();

router.get('/:handle/signing-keys', async (req, res) => {
    const { handle } = req.params;
    const user = HANDLE_PATTERN.test(handle) ? await userRepository.findByHandle(handle) : undefined;
    if (!user?.handle) {
        res.status(404).json({ error: 'Not found' });
        return;
    }
    const rows = await publishingEnvironmentRepository.listByUser(user.id);
    res.set('Access-Control-Allow-Origin', '*');
    // 取り消しを早く届けるため短くする
    res.set('Cache-Control', 'public, max-age=60');
    res.json(signingKeyListOf(selfAccount(user.handle), rows, new Date()));
});

/**
 * GET /api/v1/authors/:handle/worlds/:name.yaml（と兄弟の .lock.json / .sig.json）
 * ワールドの公開の URL（共有 URL `/@handle/name` から決まる）。DB のワールドもリポジトリのワールドも、外部ホストと同じ形で配る。
 * GET /api/v1/authors/:handle/worlds/:name は画面向けの ResolvedWorld(JSON)。名前を変えたワールドは以前の名前でもたどれる。
 */
router.get('/:handle/worlds/:file', async (req, res) => {
    try {
        const { handle, file } = req.params;
        if (file.includes('.')) {
            const found = await worldRegistry.worldFile(handle, file);
            if (!found) {
                res.status(404).json({ error: 'Not found' });
                return;
            }
            res.set('Access-Control-Allow-Origin', '*');
            // 更新・署名し直しをすぐ届ける（ETag で再検証する）
            res.set('Cache-Control', 'no-cache');
            res.type(found.contentType);
            if ('path' in found) res.sendFile(found.path);
            else res.send(found.body);
            return;
        }
        const resolution = await worldRegistry.resolveByAuthorName(handle, file);
        if (!resolution.ok) {
            res.status(resolution.reason === 'integrity' ? 422 : 404).json({
                error: resolution.message,
                code: resolution.reason,
            });
            return;
        }
        res.json(resolution.world);
    } catch (error) {
        console.error('ワールド取得エラー:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

export { router };
