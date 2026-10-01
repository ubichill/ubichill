import { publishingEnvironmentRepository, userRepository } from '@ubichill/db';
import { HANDLE_PATTERN } from '@ubichill/shared';
import { Router } from 'express';
import { selfAccount } from '../services/authorKeys';
import { signingKeyListOf } from '../services/publishingEnvironments';

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

export { router };
