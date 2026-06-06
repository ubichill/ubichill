/**
 * Socket.IO ハンドラのバレル re-export。
 * 旧 `./handlers/socketHandlers` の import path を保ったまま、実装はドメインごとに分割している。
 *
 *   worldHandlers       — join / leave / disconnect / snapshot
 *   userHandlers        — cursor / status / user-update
 *   entityHandlers      — entity CRUD (create / patch / ephemeral / delete)
 *   videoPlayerHandlers — 動画同期
 */
export { handleEntityCreate, handleEntityDelete, handleEntityEphemeral, handleEntityPatch } from './entityHandlers';
export { handleCursorMove, handleStatusUpdate, handleUserUpdate } from './userHandlers';
export {
    handleVideoPlayerStateRequest,
    handleVideoPlayerStateResponse,
    handleVideoPlayerSync,
} from './videoPlayerHandlers';
export { handleDisconnect, handleWorldJoin, handleWorldLeave, sendWorldSnapshot } from './worldHandlers';
