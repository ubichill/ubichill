import {
    CLI_AUTH_POLL_INTERVAL_MS,
    CLI_AUTH_REQUEST_TTL_MS,
    CliAuthRequestInputSchema,
    ENV_KEYS,
    normalizeUserCode,
    SERVER_CONFIG,
} from '@ubichill/shared';
import { Router } from 'express';
import { requireFreshAuth, requirePublisher, requireRecentAuth } from '../middleware/auth';
import { cliAuthService } from '../services/auth/cliAuthService';
import { publishingEnvironmentService } from '../services/authors/publishingEnvironmentService';

/**
 * CLI・CI の認可（`ubichill login` / `ubichill ci create`）。手順は docs/design/author-publishing.md §9、
 * 判定と流れは services/auth/cliAuth.ts。
 * 承認はブラウザ（ログインしたセッション）で行い、CLI は鍵の所有を証明して公開環境と API トークンを受け取る。
 */
const router = Router();

const publicBaseUrl = () => process.env[ENV_KEYS.PUBLIC_BASE_URL] || SERVER_CONFIG.DEV_URL;
/** 承認画面（フロントエンド）。本番はフロントと同じオリジン。開発でフロントが別のポートなら env FRONTEND_URL で指す。 */
const approveUrlOf = (query: string) =>
    new URL(`/cli/authorize?${query}`, process.env.FRONTEND_URL || publicBaseUrl()).href;

// 1. 要求を作る（認証なし）。ループバックなら redirectUri + codeChallenge、デバイス認可ならどちらも無し。
router.post('/requests', async (req, res) => {
    const parsed = CliAuthRequestInputSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: '要求の形式が不正です', details: parsed.error.issues });
    const created = await cliAuthService.createRequest(parsed.data);
    if (!created.ok) return res.status(created.status).json({ error: created.error });
    const { requestId, deviceCode, userCode } = created;
    return res.status(201).json({
        requestId,
        approveUrl: approveUrlOf(
            userCode ? `code=${encodeURIComponent(userCode)}` : `request=${encodeURIComponent(requestId)}`,
        ),
        expiresIn: Math.floor(CLI_AUTH_REQUEST_TTL_MS / 1000),
        ...(deviceCode && userCode
            ? { deviceCode, userCode, interval: Math.floor(CLI_AUTH_POLL_INTERVAL_MS / 1000) }
            : {}),
    });
});

// 2. 内容を見る（ログイン）。デバイス認可は画面で入力された user code で引く。
router.get('/requests/:id', requireFreshAuth, async (req, res) => {
    const request = await cliAuthService.findRequest(String(req.params.id));
    if (!request) return res.status(404).json({ error: '認可の要求が見つからないか、期限が切れています' });
    return res.json({ request });
});

router.get('/requests', requireFreshAuth, async (req, res) => {
    const code = normalizeUserCode(typeof req.query.userCode === 'string' ? req.query.userCode : '');
    if (!code) return res.status(400).json({ error: 'コードの形式が不正です（XXXX-XXXX）' });
    const request = await cliAuthService.findRequestByUserCode(code);
    if (!request) return res.status(404).json({ error: 'コードが見つからないか、期限が切れています' });
    return res.json({ request });
});

// 3. 承認する（直近の本人確認。CLI・CI のトークンはセッションを切ってもパスワードを変えても残るので、
// 古いセッションを奪っただけでは作らせない）。ループバックならリダイレクト先（認可コード付き）を返す。
router.post('/requests/:id/approve', requireRecentAuth, async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const state = typeof req.body?.state === 'string' ? req.body.state : undefined;
    const outcome = await cliAuthService.approve(req.user.id, String(req.params.id), state);
    if (!outcome.ok) return res.status(outcome.status).json({ error: outcome.error });
    return res.json({ redirect: outcome.redirect });
});

// 4. 引き換える（鍵の所有の証明）。ここで公開環境と API トークンを作る。
router.post('/token', async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const requestId = typeof body.requestId === 'string' ? body.requestId : '';
    const signature = typeof body.signature === 'string' ? body.signature : '';
    const input =
        typeof body.deviceCode === 'string'
            ? { deviceCode: body.deviceCode }
            : typeof body.code === 'string' && typeof body.codeVerifier === 'string'
              ? { code: body.code, codeVerifier: body.codeVerifier }
              : null;
    if (!requestId || !signature || !input) {
        return res.status(400).json({ error: 'requestId・signature と、code+codeVerifier か deviceCode が必要です' });
    }
    const outcome = await cliAuthService.exchange(requestId, signature, input);
    if (!outcome.ok) return res.status(outcome.status).json({ error: outcome.error, code: outcome.code });
    return res.json({
        token: outcome.token,
        account: outcome.account,
        server: new URL(publicBaseUrl()).origin,
        environment: outcome.environment,
    });
});

// ログアウト（API トークン）。この公開環境を紛失として取り消し、トークンも使えなくする。
router.post('/logout', requirePublisher, async (req, res) => {
    if (!req.user || !req.publishingEnvironment) {
        return res
            .status(400)
            .json({ error: 'API トークンで呼んでください（ブラウザの公開環境は画面から取り消します）' });
    }
    const revoked = await publishingEnvironmentService.revoke(req.user.id, req.publishingEnvironment.id, 'lost');
    return res.json({ revoked: !!revoked });
});

export { router };
