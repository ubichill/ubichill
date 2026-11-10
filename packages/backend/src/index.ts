import http from 'node:http';
import {
    announcementRepository,
    cliAuthRequestRepository,
    directMessageRepository,
    inviteRepository,
    notificationRepository,
    pendingRegistrationRepository,
} from '@ubichill/db';
import { LIMITS, MESSAGE_LIMITS, NOTIFICATION_LIMITS } from '@ubichill/shared';
import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { appConfig } from './config';
import { auth, authRateLimitEnabled } from './lib/auth';
import { isPublicAuthPath } from './lib/authEndpoints';
import { requireSharedRateLimitForLogin } from './lib/authRateLimit';
import { connectSubscriber, redis, redisHealth } from './lib/redis';
import { sharedRateLimit } from './lib/sharedRateLimit';
import { blockOfficialPasswordChange } from './middleware/auth';
import { router as authorsRouter } from './routes/authors';
import { router as cliAuthRouter } from './routes/cliAuth';
import { federationApiRouter, isFederationInboundPath, mountFederationInbound } from './routes/federation';
import { router as fediverseRouter } from './routes/fediverse';
import { router as homeRouter } from './routes/homeRouter';
import { router as instancesRouter } from './routes/instances';
import { router as invitesRouter } from './routes/invitesRouter';
import { router as messagesRouter } from './routes/messagesRouter';
import { router as notificationsRouter } from './routes/notifications';
import { router as profilesRouter } from './routes/profilesRouter';
import { router as serviceTokensRouter } from './routes/serviceTokens';
import { router as socialRouter } from './routes/social';
import { router as usersRouter } from './routes/users';
import { router as webfingerRouter } from './routes/webfinger';
import { router as worldsRouter } from './routes/worlds';
import { bootstrapOfficialAccount } from './services/authors/officialAccountStore';
import { backendEvents, createRedisBackendBus } from './services/cluster/backendEvents';
import { maintenanceGate } from './services/cluster/maintenance';
import { federation } from './services/federation';
import { instanceReaper } from './services/instances/instanceReaper';
import { createRedisNotificationBus, notificationHub } from './services/notifications/notificationHub';
import { worldRegistry } from './services/worlds/worldRegistry';
import { logger } from './utils/logger';

// Expressアプリを初期化
const app = express();

// Ingress / リバースプロキシ経由の X-Forwarded-For を信頼する
// production または TRUST_PROXY=true の場合に有効化（K8s dev 環境でも必要）
if (appConfig.isProduction || appConfig.trustProxy) {
    app.set('trust proxy', 1);
}

// セキュリティミドルウェア
app.use(helmet());

// CORS設定
app.use(
    cors({
        origin: appConfig.cors.origin,
        credentials: true,
    }),
);

// ヘルスチェック（レートリミッターより前に配置して K8s probe を除外）
// Redis の状態は載せるだけで 200 のまま返す（Redis 障害で backend を再起動させても直らない）
app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: Date.now(), redis: redisHealth(redis) });
});

// レート制限
// 認証(/api/auth)・バージョン・ヘルスは除外する。
// 特に /api/auth はセッション確認で高頻度に叩かれるため、ここで 429 を返すと
// 認証ループ（セッション失敗→/auth→再確認）に陥りバックエンドが実質ダウンする。
const limiter = rateLimit({
    windowMs: appConfig.rateLimit.windowMs,
    max: appConfig.rateLimit.maxRequests,
    message: { error: 'このIPからのリクエストが多すぎます。しばらくしてから再試行してください。' },
    standardHeaders: true,
    legacyHeaders: false,
    // ほかのサーバーからの要求は 1 つの IP から多く来るので、署名したサーバーごとに絞る（routes/federation）
    skip: (req) =>
        req.path === '/health' ||
        req.path === '/api/version' ||
        req.path.startsWith('/api/auth') ||
        isFederationInboundPath(req.path),
    ...sharedRateLimit('global', redis, logger),
});
app.use(limiter);

// ほかのサーバーからの要求（本文を生のまま受けるので JSON パーサーより前）
mountFederationInbound(app);

// JSONボディパーサー
// ワールドを送る依頼（yaml・lock・署名）は既定の上限（100KB）を超え得るので、受け付けるワールドの大きさに合わせる
app.use(
    ['/api/v1/worlds', '/api/v1/users/me/external-works'],
    express.json({ limit: LIMITS.MAX_PUBLISH_REQUEST_SIZE }),
);
app.use(express.json());

// バージョン情報エンドポイント。常に commitHash + environment を返す。
// 表示制御 (本番では出さない) はフロント側で environment === 'production' を見て行う。
app.get('/api/version', (_req, res) => {
    // Cloudflare 等に古い応答をキャッシュさせない（commit/environment が即反映されるように）
    res.set('Cache-Control', 'no-store');
    res.json({
        commitHash: process.env.COMMIT_HASH ?? 'unknown',
        environment: appConfig.nodeEnv,
    });
});

import { toNodeHandler } from 'better-auth/node';

// 認証APIのデバッグログ（ボディはパスワード等を含むため出力しない）。
// info だと本番でも全 auth リクエストを吐いてしまうため debug 時のみに絞る。
if (appConfig.debug) {
    app.use('/api/auth', (req, _res, next) => {
        logger.debug(`Auth リクエスト: ${req.method} ${req.originalUrl}`);
        next();
    });
}

// 認証API（Better Auth）- CORSとプリフライトを確実に処理するため、先に配置
app.use('/api/auth', (req, res, next) => {
    if (req.method === 'OPTIONS' || isPublicAuthPath(req.path)) return next();
    res.status(404).json({ error: 'Not Found' });
});
app.use('/api/auth/change-password', blockOfficialPasswordChange);
// ログインだけは Redis が使えない間も通さない（総当たりの上限を外さない）。ほかの認証の口は制限なしで通す
app.use('/api/auth/sign-in/email', requireSharedRateLimitForLogin(redis, authRateLimitEnabled));
app.use('/api/auth', toNodeHandler(auth));

// ============================================
// REST API ルート
// ============================================
app.use('/api/v1/worlds', worldsRouter);
app.use('/api/v1/instances', instancesRouter);
// プロフィールの編集・画像は users の `/:userId` より先に置く
app.use('/api/v1/users', profilesRouter);
app.use('/api/v1/users', homeRouter);
app.use('/api/v1/users', usersRouter);
app.use('/api/v1/social', socialRouter);
app.use('/api/v1/fediverse', fediverseRouter);
app.use('/api/v1', invitesRouter);
app.use('/api/v1/notifications', notificationsRouter);
app.use('/api/v1/messages', messagesRouter);
app.use('/api/v1/authors', authorsRouter);
app.use('/api/v1/cli-auth', cliAuthRouter);
app.use('/api/v1/federation', federationApiRouter);
app.use('/api/v1/service-tokens', serviceTokensRouter);
app.use('/.well-known/webfinger', webfingerRouter);

// HTTPサーバーを作成
const server = http.createServer(app);

// Pub/Sub の購読用の別の接続
const subscriber = redis ? connectSubscriber(redis) : null;

// ============================================
// グレースフルシャットダウン
// ============================================
function setupGracefulShutdown() {
    const shutdown = (signal: string) => {
        logger.info(`${signal} 受信 — グレースフルシャットダウン開始`);

        // 定期スイープを止め、ほかの backend がすぐ引き継げるようリースを手放す
        instanceReaper.stop();
        federation?.worker.stop();
        const released = maintenanceGate.release();
        notificationHub.closeAll();

        // 新規 HTTP 接続を拒否し、既存リクエストの完了を待つ
        server.close(() => {
            logger.info('HTTP サーバー停止完了');
            void Promise.allSettled([released, backendEvents.detach(), notificationHub.detach()]).then(() => {
                subscriber?.destroy();
                redis?.destroy();
            });
        });

        // フォールバック: 一定時間内に完了しない場合は強制終了
        setTimeout(() => {
            logger.warn('シャットダウンタイムアウト — 強制終了');
            process.exit(0);
        }, 15_000).unref();
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
}

// サーバーを起動（非同期初期化）
async function startServer() {
    // システムユーザー初期化のみ（ワールドシードは行わない）
    // 公式アカウントを先に用意する（同梱ワールドの作者の確認に使う。後だと最初の読み込みで配られない）
    await bootstrapOfficialAccount();
    await worldRegistry.initialize();

    // ほかの backend にキャッシュを捨てさせる知らせ。購読は Redis に繋がるまで待つので、起動は待たせない
    if (redis && subscriber) {
        backendEvents
            .attach(createRedisBackendBus({ publisher: redis, subscriber, log: logger }))
            .catch((err: unknown) => logger.warn('キャッシュの無効化の知らせを購読できません（TTL で揃えます）:', err));
        // 繋がるまでは、この台の SSE にだけ届ける
        notificationHub
            .attach(createRedisNotificationBus({ publisher: redis, subscriber, log: logger }))
            .catch((err: unknown) => logger.warn('通知の配送を購読できません（この台の接続にだけ届けます）:', err));
    }

    const cleanOldNotifications = async () => {
        const cutoff = new Date(Date.now() - NOTIFICATION_LIMITS.RETENTION_DAYS * 24 * 60 * 60 * 1000);
        await notificationRepository.deleteExpired(cutoff, NOTIFICATION_LIMITS.MAX_PER_RECIPIENT);
        await announcementRepository.deleteExpired(cutoff);
        await directMessageRepository.deleteExpired(
            new Date(Date.now() - MESSAGE_LIMITS.RETENTION_DAYS * 24 * 60 * 60 * 1000),
        );
    };

    // 期限切れの CLI 認可の要求と仮登録を消す（どちらも認証なしで作れるので溜めない）。reaper と同じリースを持つ 1 台だけが行う
    const cleanExpiredRequests = async () => {
        await maintenanceGate.run(async (checkpoint) => {
            if (!(await checkpoint())) return;
            await Promise.all([
                cliAuthRequestRepository
                    .deleteExpired()
                    .catch((err: unknown) => logger.error('CLI 認可の要求の掃除に失敗:', err)),
                pendingRegistrationRepository
                    .deleteExpired()
                    .catch((err: unknown) => logger.error('仮登録の掃除に失敗:', err)),
                // インスタンスが消えて消せるようになった古い版を消し直す
                worldRegistry
                    .pruneAllVersions()
                    .catch((err: unknown) => logger.error('ワールドの古い版の掃除に失敗:', err)),
                cleanOldNotifications().catch((err: unknown) => logger.error('古い通知の掃除に失敗:', err)),
                inviteRepository
                    .deleteExpired()
                    .catch((err: unknown) => logger.error('期限切れの招待の掃除に失敗:', err)),
                federation?.sweep().catch((err: unknown) => logger.error('連合の記録の掃除に失敗:', err)),
            ]);
        });
    };
    void cleanExpiredRequests();
    setInterval(() => void cleanExpiredRequests(), 10 * 60 * 1000).unref();

    // 空インスタンスの掃除（reaper）を起動。DB を定期スイープし、在席0かつ
    // 作成から猶予経過した instance を削除する。インメモリのタイマー状態に依存しないため、
    // 再起動をまたいでも孤児 instance（closing のまま残る行）が確実に回収される。
    instanceReaper.start();

    // 連合の配送（何台で動かしても同じ予定を 2 度送らない）
    if (federation) {
        federation.worker.start();
        logger.info(
            `連合: ${federation.identity.domain}（鍵の種: ${federation.config.seedSource}${federation.config.allowHttp ? '・http の相手を受ける' : ''}）`,
        );
    } else {
        logger.info('連合: 無効（FEDERATION_KEY_SEED がありません）');
    }

    setupGracefulShutdown();

    server.listen(appConfig.port, () => {
        logger.info(`サーバーを起動しました ポート=${appConfig.port} 環境=${appConfig.nodeEnv}`);
    });
}

startServer().catch((err: unknown) => {
    logger.error('サーバーの起動に失敗しました:', err);
});
