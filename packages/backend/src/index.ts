import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import {
    ServerToClientEvents,
    ClientToServerEvents,
    InterServerEvents,
    SocketData,
    SERVER_CONFIG,
    User,
    DEFAULTS
} from '@ubichill/shared';

const app = express();
app.use(cors());

const server = http.createServer(app);

const io = new Server<
    ClientToServerEvents,
    ServerToClientEvents,
    InterServerEvents,
    SocketData
>(server, {
    cors: {
        origin: "*", // 本番環境では適切に制限する
        methods: ["GET", "POST"]
    }
});

// インメモリでの状態管理（簡易実装）
// ※実運用ではRedisなどを使用することを推奨
const connectedUsers = new Map<string, User>();

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('room:join', ({ roomId, user }, callback) => {
        // ユーザー情報を保存
        const newUser: User = {
            id: socket.id,
            ...user
        };
        connectedUsers.set(socket.id, newUser);

        // ルームに参加
        socket.join(roomId);

        // ソケットデータにも保存
        socket.data.userId = socket.id;
        socket.data.roomId = roomId;
        socket.data.user = newUser;

        // 自分を含むルーム内の全ユーザーを取得
        const roomUsers = Array.from(connectedUsers.values()); // ※本来はルームでフィルタリングすべき

        // 自分に成功を通知
        callback({
            success: true,
            userId: socket.id
        });

        // 自分に現在のユーザー一覧を送信
        socket.emit('users:update', roomUsers);

        // 他のユーザーに参加を通知
        socket.to(roomId).emit('user:joined', newUser);

        console.log(`User ${newUser.name} joined room ${roomId}`);
    });

    socket.on('cursor:move', (position) => {
        const user = connectedUsers.get(socket.id);
        if (!user || !socket.data.roomId) return;

        // 位置情報を更新
        user.position = position;
        user.lastActiveAt = Date.now();

        // 他のユーザーに通知
        socket.to(socket.data.roomId).emit('cursor:moved', {
            userId: socket.id,
            position
        });
    });

    socket.on('status:update', (status) => {
        const user = connectedUsers.get(socket.id);
        if (!user || !socket.data.roomId) return;

        // ステータスを更新
        user.status = status;
        user.lastActiveAt = Date.now();

        // 他のユーザーに通知
        socket.to(socket.data.roomId).emit('status:changed', {
            userId: socket.id,
            status
        });
    });

    socket.on('disconnect', () => {
        const roomId = socket.data.roomId;
        if (connectedUsers.has(socket.id)) {
            connectedUsers.delete(socket.id);

            if (roomId) {
                // 他のユーザーに退出を通知
                socket.to(roomId).emit('user:left', socket.id);
            }
        }
        console.log('User disconnected:', socket.id);
    });
});

const PORT = process.env.PORT || SERVER_CONFIG.PORT;

server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
