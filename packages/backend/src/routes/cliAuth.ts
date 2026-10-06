import { cliAuthRequestRepository, publishingEnvironmentRepository, userRepository } from '@ubichill/db';
import {
    CLI_AUTH_POLL_INTERVAL_MS,
    CLI_AUTH_REQUEST_TTL_MS,
    CliAuthRequestInputSchema,
    cliAuthProofMessage,
    ENV_KEYS,
    normalizeUserCode,
    SERVER_CONFIG,
} from '@ubichill/shared';
import { Router } from 'express';
import { sendAccountNotice } from '../lib/auth';
import { requireFreshAuth, requirePublisher } from '../middleware/auth';
import { selfAccount } from '../services/authorKeys';
import {
    exchangeOutcome,
    loopbackRedirect,
    newApiToken,
    newUserCode,
    randomSecret,
    requestFlowOf,
    sha256Base64Url,
} from '../services/cliAuth';
import { newEnvironmentNotice, publishingEnvironmentView } from '../services/publishingEnvironments';
import { nodeWorldCrypto } from '../services/worldCrypto';
import { worldRegistry } from '../services/worldRegistry';

/**
 * CLI・CI の認可（`ubichill login` / `ubichill ci create`）。手順は docs/design/author-publishing.md §9。
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
    const flow = requestFlowOf(parsed.data);
    if (typeof flow === 'object') return res.status(400).json({ error: flow.error });
    const id = randomSecret(16);
    const deviceCode = flow === 'device' ? randomSecret(32) : null;
    const userCode = flow === 'device' ? newUserCode() : null;
    await cliAuthRequestRepository.create({
        id,
        kind: parsed.data.kind,
        name: parsed.data.name,
        publicKey: parsed.data.publicKey,
        redirectUri: parsed.data.redirectUri ?? null,
        codeChallenge: parsed.data.codeChallenge ?? null,
        userCode,
        deviceCodeHash: deviceCode ? sha256Base64Url(deviceCode) : null,
        expiresAt: new Date(Date.now() + CLI_AUTH_REQUEST_TTL_MS),
    });
    return res.status(201).json({
        requestId: id,
        approveUrl: approveUrlOf(
            userCode ? `code=${encodeURIComponent(userCode)}` : `request=${encodeURIComponent(id)}`,
        ),
        expiresIn: Math.floor(CLI_AUTH_REQUEST_TTL_MS / 1000),
        ...(deviceCode && userCode
            ? { deviceCode, userCode, interval: Math.floor(CLI_AUTH_POLL_INTERVAL_MS / 1000) }
            : {}),
    });
});

/** 承認画面に見せる要求の内容（秘密は返さない）。 */
const requestView = (r: NonNullable<Awaited<ReturnType<typeof cliAuthRequestRepository.findActive>>>) => ({
    id: r.id,
    kind: r.kind,
    name: r.name,
    publicKey: r.publicKey,
    flow: r.redirectUri ? 'loopback' : 'device',
    redirectHost: r.redirectUri ? new URL(r.redirectUri).host : null,
    userCode: r.userCode,
    status: r.status,
    expiresAt: r.expiresAt.toISOString(),
});

// 2. 内容を見る（ログイン）。デバイス認可は画面で入力された user code で引く。
router.get('/requests/:id', requireFreshAuth, async (req, res) => {
    const request = await cliAuthRequestRepository.findActive(String(req.params.id));
    if (!request) return res.status(404).json({ error: '認可の要求が見つからないか、期限が切れています' });
    return res.json({ request: requestView(request) });
});

router.get('/requests', requireFreshAuth, async (req, res) => {
    const code = normalizeUserCode(typeof req.query.userCode === 'string' ? req.query.userCode : '');
    if (!code) return res.status(400).json({ error: 'コードの形式が不正です（XXXX-XXXX）' });
    const request = await cliAuthRequestRepository.findActiveByUserCode(code);
    if (!request) return res.status(404).json({ error: 'コードが見つからないか、期限が切れています' });
    return res.json({ request: requestView(request) });
});

// 3. 承認する（ログイン、DB のセッション）。ループバックならリダイレクト先（認可コード付き）を返す。
router.post('/requests/:id/approve', requireFreshAuth, async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const user = await userRepository.findById(req.user.id);
    if (!user?.handle) return res.status(409).json({ error: '先に ID を設定してください（作者アカウントが必要です）' });
    const request = await cliAuthRequestRepository.findActive(String(req.params.id));
    if (request?.status !== 'pending') {
        return res.status(404).json({ error: '承認できる要求が見つかりません（期限切れか、処理済みです）' });
    }
    const code = request.redirectUri ? randomSecret(32) : null;
    const approved = await cliAuthRequestRepository.approve(request.id, user.id, code ? sha256Base64Url(code) : null);
    if (!approved) return res.status(409).json({ error: 'この要求はすでに処理されています' });
    const state = typeof req.body?.state === 'string' ? req.body.state : undefined;
    return res.json({
        redirect: request.redirectUri && code ? loopbackRedirect(request.redirectUri, code, state) : null,
    });
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
    const request = await cliAuthRequestRepository.findActive(requestId);
    const outcome = exchangeOutcome(request, input, new Date());
    if (!outcome.ok) return res.status(outcome.status).json({ error: outcome.error, code: outcome.code });
    if (!request?.userId) return res.status(400).json({ error: '認可コードが一致しません', code: 'invalid-grant' });
    const proved = await nodeWorldCrypto.verifyEd25519(request.publicKey, cliAuthProofMessage(request.id), signature);
    if (!proved) return res.status(400).json({ error: '鍵の所有を確認できません', code: 'invalid-proof' });

    // 1 回だけ引き換えられる（同時に送られても 1 つしか通らない）
    const consumed = await cliAuthRequestRepository.consume(request.id);
    if (!consumed) return res.status(409).json({ error: 'この認可の要求は引き換え済みです', code: 'consumed' });
    const user = await userRepository.findById(request.userId);
    if (!user?.handle) return res.status(409).json({ error: '作者アカウントが見つかりません' });
    if (await publishingEnvironmentRepository.findByPublicKey(request.publicKey)) {
        return res.status(409).json({ error: 'この鍵は登録できません（作り直してください）', code: 'taken' });
    }
    const token = newApiToken();
    const environment = await publishingEnvironmentRepository.create({
        userId: user.id,
        kind: request.kind,
        name: request.name,
        publicKey: request.publicKey,
        apiTokenHash: sha256Base64Url(token),
    });
    worldRegistry.invalidateResolvedWorlds();
    const notice = newEnvironmentNotice({
        displayName: user.name,
        environmentName: environment.name,
        siteUrl: new URL('/', publicBaseUrl()).href,
        at: environment.createdAt,
    });
    void sendAccountNotice(user.email, notice.subject, notice.text);
    return res.json({
        token,
        account: selfAccount(user.handle),
        server: new URL(publicBaseUrl()).origin,
        environment: publishingEnvironmentView(environment),
    });
});

// ログアウト（API トークン）。この公開環境を紛失として取り消し、トークンも使えなくする。
router.post('/logout', requirePublisher, async (req, res) => {
    if (!req.user || !req.publishingEnvironment) {
        return res
            .status(400)
            .json({ error: 'API トークンで呼んでください（ブラウザの公開環境は画面から取り消します）' });
    }
    const revoked = await publishingEnvironmentRepository.revoke(req.user.id, req.publishingEnvironment.id, 'lost');
    worldRegistry.invalidateResolvedWorlds();
    return res.json({ revoked: !!revoked });
});

export { router };
