import http from 'node:http';
// Force restart check
import type { ClientToServerEvents, InterServerEvents, ServerToClientEvents, SocketData } from '@ubichill/shared';
import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { Server } from 'socket.io';
import { appConfig } from './config';
import {
    handleCursorMove,
    handleDisconnect,
    handleEntityCreate,
    handleEntityDelete,
    handleEntityEphemeral,
    handleEntityPatch,
    handleMediaStateRequest,
    handleMediaStateResponse,
    handleMediaSync,
    handleStatusUpdate,
    handleUserUpdate,
    handleWorldJoin,
    handleWorldLeave,
} from './handlers/socketHandlers';
import { auth } from './lib/auth';
import { socketAuthMiddleware } from './middleware/socketAuth';
import { router as instancesRouter } from './routes/instances';
import { router as usersRouter } from './routes/users';
import { router as worldsRouter } from './routes/worlds';
import { instanceReaper } from './services/instanceReaper';
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
    skip: (req) =>
        req.path === '/health' ||
        req.path === '/api/version' ||
        req.path.startsWith('/api/auth') ||
        req.path.startsWith('/socket.io'),
});
app.use(limiter);

// JSONボディパーサー
app.use(express.json());

// バージョン情報エンドポイント。常に commitHash + environment を返す。
// 表示制御 (本番では出さない) はフロント側で environment === 'production' を見て行う。
app.get('/api/version', (_req, res) => {
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
app.use('/api/auth', toNodeHandler(auth));

// ============================================
// REST API ルート
// ============================================
app.use('/api/v1/worlds', worldsRouter);
app.use('/api/v1/instances', instancesRouter);
app.use('/api/v1/users', usersRouter);

// HTTPサーバーを作成
const server = http.createServer(app);

// 型付きイベントでSocket.IOを初期化
const io = new Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>(server, {
    cors: {
        origin: appConfig.cors.origin,
        methods: ['GET', 'POST'],
        credentials: true,
    },
});

// ============================================
// Socket.IO 認証ミドルウェア（接続時に better-auth 検証）
// ============================================
io.use(socketAuthMiddleware);

// Socket.IO 接続ハンドラー
io.on('connection', (socket) => {
    const authUser = socket.data.authUser;
    console.log(`🔌 新しい接続: ${socket.id.substring(0, 8)} (user: ${authUser?.name ?? 'unknown'})`);

    // 既存イベントハンドラー
    socket.on('world:join', handleWorldJoin(socket));
    socket.on('world:leave', handleWorldLeave(socket));
    socket.on('cursor:move', handleCursorMove(socket));
    socket.on('status:update', handleStatusUpdate(socket));
    socket.on('user:update', handleUserUpdate(socket));
    socket.on('disconnect', handleDisconnect(socket));

    // UEP (Ubichill Entity Protocol) イベントハンドラー
    socket.on('entity:create', handleEntityCreate(socket));
    socket.on('entity:patch', handleEntityPatch(socket));
    socket.on('entity:ephemeral', handleEntityEphemeral(socket));
    socket.on('entity:delete', handleEntityDelete(socket));

    // メディア (動画/音声) peer 間同期
    socket.on('media:sync', handleMediaSync(socket));
    socket.on('media:state-request', handleMediaStateRequest(socket));
    socket.on('media:state-response', handleMediaStateResponse(socket));
});

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

        // Socket.IO を閉じる（既存クライアントに disconnect イベントを送信）
        io.close(() => {
            console.log('✅ Socket.IO 停止完了');
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
