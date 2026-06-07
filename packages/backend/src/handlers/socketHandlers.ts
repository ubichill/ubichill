/**
 * Socket.IO ハンドラのバレル re-export。
 * 旧 `./handlers/socketHandlers` の import path を保ったまま、実装はドメインごとに分割している。
 *
 *   worldHandlers  — join / leave / disconnect / snapshot
 *   userHandlers   — cursor / status / user-update
 *   entityHandlers — entity CRUD (create / patch / ephemeral / delete)
 *   mediaHandlers  — メディア (動画 / 音声) の peer 間同期
 */
export { handleEntityCreate, handleEntityDelete, handleEntityEphemeral, handleEntityPatch } from './entityHandlers';
export { handleMediaStateRequest, handleMediaStateResponse, handleMediaSync } from './mediaHandlers';
export { handleCursorMove, handleStatusUpdate, handleUserUpdate } from './userHandlers';
export { handleDisconnect, handleWorldJoin, handleWorldLeave, sendWorldSnapshot } from './worldHandlers';
