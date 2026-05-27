/**
 * avatar plugin Worker 間/Host 間通信の単一スキーマ。
 *
 * Host→Worker の sendToWorker(type, payload) はフラットな event.type で届くので、
 * 旧 `host:message` 入れ子はもう存在しない。type をここに宣言すれば on(type, ...) で受けられる。
 */

import type { AppAvatarDef, InputMouseMoveData } from '@ubichill/sdk';

interface AnimFrame {
    url: string;
    duration: number;
}

export const AvatarEvents = Ubi.event.define<{
    // ── SDK 由来: 入力 ──
    'input:cursor_style': { style: string };
    'input:mouse_move': InputMouseMoveData;
    // ── SDK 由来: プレイヤー ──
    'player:joined': { id: string; avatar?: AppAvatarDef };
    // ── Host → Worker (sendToWorker でフラットに届く) ──
    'avatar:localFrames': { framesMap: Record<string, AnimFrame[]> };
    'avatar:thumbnails': { thumbnails: Record<string, string> };
    // ── Worker → Host (sendToHost) ──
    'avatar:initThumbnails': { thumbnailFiles: Array<{ id: string; url: string }> };
    'avatar:applyTemplate': { files: Array<{ state: string; url: string }> };
    'avatar:resetTemplate': Record<string, never>;
    'avatar:requestFrames': { sourceUrls: Array<{ state: string; sourceUrl: string }> };
    'user:update': { avatar: AppAvatarDef };
}>();
