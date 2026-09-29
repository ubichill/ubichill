import { userRepository } from '@ubichill/db';
import {
    DISPLAY_NAME_WEBFINGER_PROPERTY,
    ENV_KEYS,
    formatAuthorAccount,
    parseAuthorAccount,
    SERVER_CONFIG,
    SIGNING_KEYS_WEBFINGER_REL,
} from '@ubichill/shared';
import { Router } from 'express';
import { selfDomain } from '../services/authorKeys';

/**
 * GET /.well-known/webfinger?resource=acct:handle@domain（RFC 7033）
 *
 * このサーバーが発行した作者アカウントの表示名と、公開環境の鍵一覧へのリンクを公開する。他サーバーはこれで
 * 「その作者の有効な鍵で署名されたワールドか」を確認し、作者名をその時点の表示名で表示する。公開情報のみ。
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
            properties: { [DISPLAY_NAME_WEBFINGER_PROPERTY]: user.name },
            links: [
                {
                    rel: SIGNING_KEYS_WEBFINGER_REL,
                    type: 'application/json',
                    href: new URL(
                        `/api/v1/authors/${encodeURIComponent(account.handle)}/signing-keys`,
                        process.env[ENV_KEYS.PUBLIC_BASE_URL] || SERVER_CONFIG.DEV_URL,
                    ).href,
                },
            ],
        }),
    );
});

export { router };
