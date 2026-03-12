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
    handleStatusUpdate,
    handleUserUpdate,
    handleVideoPlayerSync,
    handleWorldJoin,
} from './handlers/socketHandlers';
import { auth } from './lib/auth';
import { socketAuthMiddleware } from './middleware/socketAuth';
import audioRouter from './routes/audio';
import instancesRouter from './routes/instances';
import usersRouter from './routes/users';
import worldsRouter from './routes/worlds';
import { worldRegistry } from './services/worldRegistry';

// Expressアプリを初期化
const app = express();

// セキュリティミドルウェア
app.use(helmet());

// CORS設定
app.use(
    cors({
        origin: appConfig.cors.origin,
        credentials: true,
    }),
);

// レート制限
const limiter = rateLimit({
    windowMs: appConfig.rateLimit.windowMs,
    max: appConfig.rateLimit.maxRequests,
    message: 'このIPからのリクエストが多すぎます。しばらくしてから再試行してください。',
    standardHeaders: true,
    legacyHeaders: false,
});
app.use(limiter);

// JSONボディパーサー
app.use(express.json());

// ヘルスチェックエンドポイント
app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: Date.now() });
});

// バージョン情報エンドポイント（ビルド時のコミットハッシュを返す）
app.get('/api/version', (_req, res) => {
    res.json({
        commitHash: process.env.COMMIT_HASH ?? 'unknown',
        environment: appConfig.nodeEnv,
    });
});

// オーディオAPI（YouTube音楽ストリーム）
app.use('/api/audio', audioRouter);

import { toNodeHandler } from 'better-auth/node';

// 認証APIのデバッグログ
app.use('/api/auth', (req, _res, next) => {
    console.log(`🔐 Auth リクエスト: ${req.method} ${req.originalUrl}`);
    if (req.method === 'POST') {
        console.log(`   Body:`, JSON.stringify(req.body, null, 2));
    }
    next();
});

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
    socket.on('cursor:move', handleCursorMove(socket));
    socket.on('status:update', handleStatusUpdate(socket));
    socket.on('user:update', handleUserUpdate(socket));
    socket.on('disconnect', handleDisconnect(socket));

    // UEP (Ubichill Entity Protocol) イベントハンドラー
    socket.on('entity:create', handleEntityCreate(socket));
    socket.on('entity:patch', handleEntityPatch(socket));
    socket.on('entity:ephemeral', handleEntityEphemeral(socket));
    socket.on('entity:delete', handleEntityDelete(socket));

    // Video Player同期
    socket.on('video-player:sync', handleVideoPlayerSync(socket));
});

// サーバーを起動（非同期初期化）
async function startServer() {
    // ワールド定義を読み込み
    await worldRegistry.loadWorlds();

    // ワールド数を取得（非同期）
    const worlds = await worldRegistry.listWorlds();

    server.listen(appConfig.port, () => {
        console.log('');
        console.log('🚀 Ubichill サーバー起動');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log(`   🌐 ポート ${appConfig.port} で起動中`);
        console.log(`   📍 環境: ${appConfig.nodeEnv}`);
        console.log(`   📁 ワールド数: ${worlds.length}`);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('');
    });
}

console.log('🏁 calling startServer()...');
startServer().catch((err) => {
    console.error('❌ Unhandled error in startServer:', err);
});
