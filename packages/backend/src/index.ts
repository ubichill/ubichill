import http from 'node:http';
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
    handleRoomJoin,
    handleStatusUpdate,
} from './handlers/socketHandlers';
import roomsRouter from './routes/rooms';
import instancesRouter from './routes/instances';
import { roomRegistry } from './services/roomRegistry';

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

// ============================================
// REST API ルート
// ============================================
app.use('/api/v1/rooms', roomsRouter);
app.use('/api/v1/instances', instancesRouter);

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

// Socket.IOの接続処理
io.on('connection', (socket) => {
    console.log(`🔌 新しい接続: ${socket.id.substring(0, 8)}`);

    // 既存イベントハンドラー
    socket.on('room:join', handleRoomJoin(socket));
    socket.on('cursor:move', handleCursorMove(socket));
    socket.on('status:update', handleStatusUpdate(socket));
    socket.on('disconnect', handleDisconnect(socket));

    // UEP (Ubichill Entity Protocol) イベントハンドラー
    socket.on('entity:create', handleEntityCreate(socket));
    socket.on('entity:patch', handleEntityPatch(socket));
    socket.on('entity:ephemeral', handleEntityEphemeral(socket));
    socket.on('entity:delete', handleEntityDelete(socket));
});

// サーバーを起動（非同期初期化）
async function startServer() {
    // ルーム定義を読み込み
    await roomRegistry.loadRooms();

    server.listen(appConfig.port, () => {
        console.log('');
        console.log('🚀 Ubichill サーバー起動');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log(`   🌐 ポート ${appConfig.port} で起動中`);
        console.log(`   📍 環境: ${appConfig.nodeEnv}`);
        console.log(`   📁 ルーム数: ${roomRegistry.listRooms().length}`);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('');
    });
}

startServer().catch(console.error);
