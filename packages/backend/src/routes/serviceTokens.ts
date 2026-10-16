import { ENV_KEYS, ModLockEntrySchema, normalizeServiceAudience, SERVER_CONFIG } from '@ubichill/shared';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { requireFreshAuth } from '../middleware/auth';
import { isAuthorKey } from '../services/authorKeyStore';
import { modAuthorForToken, type ServiceTokenIssuer, serviceTokenIssuerFromEnv } from '../services/serviceTokens';
import { nodeWorldCrypto } from '../services/worldCrypto';
import { logger } from '../utils/logger';

/**
 * サービストークン（mod が外部サービスへ渡す、ログイン中の利用者であることの証明）。
 * 手順と検証方法は docs/SERVICE_TOKEN.md。
 */
export const router = Router();

const issuerOrigin = (process.env[ENV_KEYS.PUBLIC_BASE_URL] || SERVER_CONFIG.DEV_URL).replace(/\/$/, '');
// 鍵が壊れていれば起動時に失敗させる（気づかないまま発行できない状態にしない）。
const tokenIssuer: ServiceTokenIssuer | null = serviceTokenIssuerFromEnv(process.env, issuerOrigin, (m) =>
    logger.warn(m),
);

const IssueRequestSchema = z.object({
    audience: z.string().max(2048),
    modId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/),
    /** 依頼した mod の作者署名（Host が読み込み時に確認できたもの）。サーバーが確かめ直して `mod_author` に載せる。 */
    authorProof: z.object({ entry: ModLockEntrySchema, signature: z.unknown().optional() }).optional(),
});

// ホストはトークンを期限まで使い回すので、通常の利用ではこの上限に届かない。
const issueLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 60,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.user?.id ?? 'anonymous',
    message: { error: 'サービストークンの発行が多すぎます。しばらくしてから再試行してください。' },
});

router.get('/keys', (_req, res) => {
    const issuer = tokenIssuer;
    if (!issuer) {
        res.status(503).json({ error: 'このサーバーはサービストークンを発行していません' });
        return;
    }
    res.set('Cache-Control', 'public, max-age=300');
    res.json(issuer.jwks());
});

// 失効したセッションの cookie キャッシュから、新しい身元証明を発行しない。
router.post('/', requireFreshAuth, issueLimiter, async (req, res) => {
    const issuer = tokenIssuer;
    if (!issuer) {
        res.status(503).json({ error: 'このサーバーはサービストークンを発行していません' });
        return;
    }
    const parsed = IssueRequestSchema.safeParse(req.body);
    if (!parsed.success) {
        const audienceIssue = parsed.error.issues.some((issue) => issue.path[0] === 'audience');
        res.status(400).json(
            audienceIssue
                ? {
                      error: '宛先はサービスのオリジン（https://example.com）で指定してください',
                      code: 'audience-invalid',
                  }
                : { error: '依頼の形式が違います（mod の ID・作者署名）', code: 'invalid-request' },
        );
        return;
    }
    const audience = normalizeServiceAudience(parsed.data.audience);
    if (!audience) {
        res.status(400).json({
            error: '宛先はサービスのオリジン（https://example.com）で指定してください',
            code: 'audience-invalid',
        });
        return;
    }
    if (audience === new URL(issuer.issuer).origin) {
        res.status(400).json({ error: 'Ubichill 自身を宛先にはできません', code: 'audience-invalid' });
        return;
    }
    const userId = req.user?.id;
    if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }
    const { modId, authorProof } = parsed.data;
    // 署名の無い証明（signature の欠落）は、証明が無い依頼ではなく「通らない証明」として扱う
    const proof = authorProof && { entry: authorProof.entry, signature: authorProof.signature };
    const author = await modAuthorForToken(modId, proof, { crypto: nodeWorldCrypto, isAuthorKey });
    if (!author.ok) {
        res.status(author.status).json({ error: author.error, code: author.code });
        return;
    }
    res.set('Cache-Control', 'no-store');
    res.json(issuer.issue({ userId, audience, modId, modAuthor: author.modAuthor }));
});
