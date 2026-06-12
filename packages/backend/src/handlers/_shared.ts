/**
 * Socket ハンドラ全体で共有される型・状態・ヘルパー。
 * 個別の handler ファイルからのみ import される (外向きに公開しない)。
 */
import type { ClientToServerEvents, InterServerEvents, ServerToClientEvents, SocketData } from '@ubichill/shared';
import type { Socket } from 'socket.io';

export type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

/**
 * 切断後の grace timer 一覧。userId → timeout handle。
 * handleDisconnect で setup、handleWorldJoin / handleWorldLeave で cancel される。
 */
export const disconnectTimers = new Map<string, NodeJS.Timeout>();

/**
 * userId → 現在アクティブな socket のマップ。
 * 同一 userId で別 socket が join してきた時 (タブ切替等) の takeover 検出に使う。
 * - handleWorldJoin が set、handleWorldLeave / Disconnect grace timer が delete
 * - 旧 socket の handleDisconnect は activeUserSockets.get(userId) !== self なら no-op 化
 */
export const activeUserSockets = new Map<string, TypedSocket>();

/**
 * ID 統一: User.id / userManager のキー / broadcast の userId は
 * すべて DB の users.id (better-auth セッションの user.id) に統一する。
 * これにより、フロントの currentUser.id と worldRecord.authorId が直接比較できる。
 *
 * NOTE: Socket.IO のルーミング・DM (socket.to(socket.id)) には引き続き socket.id を使う。
 *       socket.id は接続単位、stableUserId はユーザー単位（同一ユーザーが複数 socket を持ちうる）。
 */
export function stableUserId(socket: TypedSocket): string | undefined {
    return socket.data.authUser?.id;
}
