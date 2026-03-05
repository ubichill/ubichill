import type { ClientToServerEvents, InterServerEvents, ServerToClientEvents, SocketData } from '@ubichill/shared';
import type { Socket } from 'socket.io';
import { auth } from '../lib/auth';
import { logger } from '../utils/logger';

type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

/**
 * Socket.IO 接続時の認証ミドルウェア
 *
 * WebSocket ハンドシェイク時のリクエストヘッダー（Cookie含む）から
 * better-auth セッションを検証し、認証済みユーザー情報を socket.data に格納する。
 * 未認証の場合は接続を拒否する。
 *
 * @example
 *   io.use(socketAuthMiddleware);
 */
export async function socketAuthMiddleware(socket: TypedSocket, next: (err?: Error) => void): Promise<void> {
    try {
        // ハンドシェイク時のヘッダーを Web 標準の Headers に変換
        const rawHeaders = socket.handshake.headers;
        const headers = new Headers(
            Object.entries(rawHeaders).reduce(
                (acc, [key, value]) => {
                    if (value) acc[key] = Array.isArray(value) ? value.join(', ') : value;
                    return acc;
                },
                {} as Record<string, string>,
            ),
        );

        // better-auth でセッションを検証
        const session = await auth.api.getSession({ headers });

        if (!session) {
            logger.warn(`🔒 WebSocket 認証失敗 (未認証): ${socket.id.substring(0, 8)}`);
            next(new Error('Unauthorized'));
            return;
        }

        // 認証済みユーザー情報を socket.data に格納（以降のハンドラーで利用可能）
        socket.data.authUser = {
            id: session.user.id,
            email: session.user.email,
            name: session.user.name,
            image: session.user.image ?? null,
        };

        logger.debug(
            `🔓 WebSocket 認証成功: user=${session.user.name} (${session.user.id.substring(0, 8)}) socket=${socket.id.substring(0, 8)}`,
        );

        next();
    } catch (error) {
        logger.error('WebSocket 認証ミドルウェアエラー:', error);
        next(new Error('Unauthorized'));
    }
}
