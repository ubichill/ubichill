import { authorKeyRepository, userRepository } from '@ubichill/db';
import { HANDLE_PATTERN } from '@ubichill/shared';
import { Router } from 'express';
import { selfAccount } from '../services/authors/authorKeys';
import { signingKeyListOf } from '../services/authors/publishingEnvironments';
import { modCatalog, modDescriptor } from '../services/mods/catalog';
import { worldRegistry } from '../services/worlds/worldRegistry';
import { logger } from '../utils/logger';

/**
 * GET /api/v1/authors/:handle/signing-keys
 *
 * このサーバーの作者アカウントの公開環境の鍵一覧（WebFinger の links から辿る）。ほかのサーバーはこれで
 * 署名鍵がその作者の有効な鍵かを確かめる。取り消した鍵も revokedAt 付きで返す。公開情報のみ。
 */
const router = Router();

router.get('/:handle/mods/:name', async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    const descriptor = await modDescriptor(req.params.handle, req.params.name);
    if (!descriptor) return res.status(404).json({ error: '公開先で作者を確認できる mod が見つかりません' });
    res.set('Cache-Control', 'public, max-age=60');
    return res.json(descriptor);
});
router.get('/:handle/mods', async (req, res) => {
    const offset = Number(req.query.offset ?? 0);
    if (!HANDLE_PATTERN.test(req.params.handle) || !Number.isSafeInteger(offset) || offset < 0 || offset > 10000)
        return res.status(400).json({ error: '指定が不正です' });
    res.set('Access-Control-Allow-Origin', '*');
    return res.json(await modCatalog('', offset, req.params.handle));
});

router.get('/:handle/signing-keys', async (req, res) => {
    const { handle } = req.params;
    const user = HANDLE_PATTERN.test(handle) ? await userRepository.findByHandle(handle) : undefined;
    if (!user) {
        res.status(404).json({ error: 'Not found' });
        return;
    }
    const rows = await authorKeyRepository.listByUser(user.id);
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
        res.json({ ...resolution.world, sharePath: await worldRegistry.externalSharePath(resolution.world) });
    } catch (error) {
        logger.error('ワールド取得エラー:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

export { router };
