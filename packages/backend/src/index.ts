import http from 'node:http';
import { cliAuthRequestRepository } from '@ubichill/db';
import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { appConfig } from './config';
import { auth } from './lib/auth';
import { blockOfficialPasswordChange } from './middleware/auth';
import { router as authorsRouter } from './routes/authors';
import { router as cliAuthRouter } from './routes/cliAuth';
import { router as federationRouter } from './routes/federation';
import { router as instancesRouter } from './routes/instances';
import { router as socialRouter } from './routes/social';
import { router as usersRouter } from './routes/users';
import { router as webfingerRouter } from './routes/webfinger';
import { router as worldsRouter } from './routes/worlds';
import { instanceReaper } from './services/instanceReaper';
import { bootstrapOfficialAccount } from './services/officialAccountStore';
import { worldRegistry } from './services/worldRegistry';
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
app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: Date.now() });
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
    skip: (req) => req.path === '/health' || req.path === '/api/version' || req.path.startsWith('/api/auth'),
});
app.use(limiter);

// JSONボディパーサー
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
// console.log だと本番でも全 auth リクエストを吐いてしまうため debug 時のみに絞る。
if (appConfig.debug) {
    app.use('/api/auth', (req, _res, next) => {
        logger.debug(`🔐 Auth リクエスト: ${req.method} ${req.originalUrl}`);
        next();
    });
}

// 認証API（Better Auth）- CORSとプリフライトを確実に処理するため、先に配置
app.use('/api/auth/change-password', blockOfficialPasswordChange);
app.use('/api/auth', toNodeHandler(auth));

// ============================================
// REST API ルート
// ============================================
app.use('/api/v1/worlds', worldsRouter);
app.use('/api/v1/instances', instancesRouter);
app.use('/api/v1/users', usersRouter);
app.use('/api/v1/social', socialRouter);
app.use('/api/v1/authors', authorsRouter);
app.use('/api/v1/cli-auth', cliAuthRouter);
app.use('/api/v1/federation', federationRouter);
app.use('/.well-known/webfinger', webfingerRouter);

// HTTPサーバーを作成
const server = http.createServer(app);

// ============================================
// グレースフルシャットダウン
// ============================================
function setupGracefulShutdown() {
    const shutdown = (signal: string) => {
        console.log(`⚡ ${signal} 受信 — グレースフルシャットダウン開始`);

        // 定期スイープを止める
        instanceReaper.stop();

        // 新規 HTTP 接続を拒否し、既存リクエストの完了を待つ
        server.close(() => {
            console.log('✅ HTTP サーバー停止完了');
        });

        // フォールバック: 一定時間内に完了しない場合は強制終了
        setTimeout(() => {
            console.warn('⏰ シャットダウンタイムアウト — 強制終了');
            process.exit(0);
        }, 15_000).unref();
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
}

// サーバーを起動（非同期初期化）
async function startServer() {
    // システムユーザー初期化のみ（ワールドシードは行わない）
    await worldRegistry.initialize();
    await bootstrapOfficialAccount();

    // 期限切れの CLI 認可の要求を消す（認証なしで作れるので溜めない）
    const cleanCliAuthRequests = () =>
        cliAuthRequestRepository
            .deleteExpired()
            .catch((err: unknown) => console.error('CLI 認可の要求の掃除に失敗:', err));
    void cleanCliAuthRequests();
    setInterval(cleanCliAuthRequests, 10 * 60 * 1000).unref();

    // 空インスタンスの掃除（reaper）を起動。DB を定期スイープし、在席0かつ
    // 作成から猶予経過した instance を削除する。インメモリのタイマー状態に依存しないため、
    // 再起動をまたいでも孤児 instance（closing のまま残る行）が確実に回収される。
    instanceReaper.start();

    setupGracefulShutdown();

    server.listen(appConfig.port, () => {
        console.log('');
        console.log('🚀 Ubichill サーバー起動');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log(`   🌐 ポート ${appConfig.port} で起動中`);
        console.log(`   📍 環境: ${appConfig.nodeEnv}`);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('');
    });
}

console.log('🏁 calling startServer()...');
startServer().catch((err) => {
    console.error('❌ Unhandled error in startServer:', err);
});
