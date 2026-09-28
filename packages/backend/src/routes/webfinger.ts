import { userRepository } from '@ubichill/db';
import {
    DISPLAY_NAME_WEBFINGER_PROPERTY,
    formatAuthorAccount,
    parseAuthorAccount,
    SIGNING_KEY_WEBFINGER_PROPERTY,
} from '@ubichill/shared';
import { Router } from 'express';
import { selfDomain } from '../services/authorKeys';

/**
 * GET /.well-known/webfinger?resource=acct:handle@domain（RFC 7033）
 *
 * このサーバーが発行した作者アカウントの署名公開鍵と表示名を公開する。他サーバーはこれで
 * 「その handle の鍵で署名されたワールドか」を確認し、作者名をその時点の表示名で表示する。公開情報のみ。
 */
const router = Router();

router.get('/', async (req, res) => {
    const resource = typeof req.query.resource === 'string' ? req.query.resource : '';
    const account = resource.startsWith('acct:') ? parseAuthorAccount(resource) : null;
    if (!account) {
        res.status(400).json({ error: 'resource=acct:handle@domain が必要です' });
        return;
    }
    if (account.domain !== selfDomain()) {
        res.status(404).json({ error: 'このサーバーのアカウントではありません' });
        return;
    }
    const user = await userRepository.findByHandle(account.handle);
    if (!user) {
        res.status(404).json({ error: 'Not found' });
        return;
    }
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Cache-Control', 'public, max-age=300');
    res.type('application/jrd+json').send(
        JSON.stringify({
            subject: `acct:${formatAuthorAccount(account)}`,
            properties: {
                [DISPLAY_NAME_WEBFINGER_PROPERTY]: user.name,
                ...(user.signingPublicKey ? { [SIGNING_KEY_WEBFINGER_PROPERTY]: user.signingPublicKey } : {}),
            },
        }),
    );
});

export { router };
