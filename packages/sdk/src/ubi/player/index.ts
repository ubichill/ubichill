/**
 * Ubi.player — プレイヤー (= ユーザー) 情報。
 *
 * - me: 自分の id (Ubi.myUserId へのショートカット)
 * - others(): 自分以外のユーザーの位置情報
 * - all():    自分含む全ユーザーの位置情報
 * - scroll(): ワールドスクロール量
 * - syncCursor(opts): 自分のカーソル位置を一定 throttle で host へ通知
 */

import { CommandType } from '@ubichill/shared';
import type { PresenceEntry, SendFn } from '../types';

export interface PlayerInfo {
    id: string;
    worldX: number;
    worldY: number;
    viewportX: number;
    viewportY: number;
}

export type PlayerModule = {
    // ── Public API ────────────────────────────────────────
    others(): ReadonlyMap<string, PlayerInfo>;
    all(): ReadonlyMap<string, PlayerInfo>;
    scroll(): { readonly x: number; readonly y: number };
    syncCursor(options?: { throttleMs?: number }): void;
    // ── Internal accessors (state module + UbiSDK から使用) ──
    getPresenceUsers(): Map<string, PresenceEntry>;
    getLocalSharedState(): Record<string, unknown>;
    getScrollX(): number;
    getScrollY(): number;
    getForEachUserComponents(): Set<string>;
    // ── Event handlers (_dispatchEvent から呼ばれる) ──────
    handlePlayerJoined(user: {
        id: string;
        position?: { x: number; y: number };
        avatar?: unknown;
        cursorState?: unknown;
    }): void;
    handlePlayerLeft(userId: string): void;
    handleCursorMoved(userId: string, position: { x: number; y: number }, sharedState?: Record<string, unknown>): void;
    handleScrollInput(x: number, y: number, now: number): void;
    handleMouseMoveInput(viewportX: number, viewportY: number, now: number): void;
    handlePresenceSharedState(userId: string, sharedState: Record<string, unknown>): void;
};

export function createPlayerModule(send: SendFn, getMyUserId: () => string | undefined): PlayerModule {
    const presenceUsers = new Map<string, PresenceEntry>();
    const forEachUserComponents = new Set<string>();
    const localSharedState: Record<string, unknown> = {};
    let scrollX = 0;
    let scrollY = 0;
    let localViewportX = 0;
    let localViewportY = 0;
    let positionSyncThrottleMs = 0;
    let lastPositionSent = 0;

    const trySendPosition = (worldX: number, worldY: number, now: number): void => {
        if (positionSyncThrottleMs <= 0) return;
        if (now - lastPositionSent < positionSyncThrottleMs) return;
        lastPositionSent = now;
        send({
            type: CommandType.NETWORK_SEND_TO_HOST,
            payload: {
                type: 'position:update',
                data: { x: worldX, y: worldY, sharedState: localSharedState },
            },
        });
    };

    const toPlayerInfo = (id: string, entry: PresenceEntry): PlayerInfo => ({
        id,
        worldX: entry.worldX,
        worldY: entry.worldY,
        viewportX: entry.worldX - scrollX,
        viewportY: entry.worldY - scrollY,
    });

    return {
        others: () => {
            const myId = getMyUserId();
            const result = new Map<string, PlayerInfo>();
            for (const [id, entry] of presenceUsers) {
                if (id === myId) continue;
                result.set(id, toPlayerInfo(id, entry));
            }
            return result;
        },
        all: () => {
            const result = new Map<string, PlayerInfo>();
            for (const [id, entry] of presenceUsers) result.set(id, toPlayerInfo(id, entry));
            return result;
        },
        scroll: () => ({ x: scrollX, y: scrollY }),
        syncCursor: (options) => {
            positionSyncThrottleMs = options?.throttleMs ?? 50;
        },

        getPresenceUsers: () => presenceUsers,
        getLocalSharedState: () => localSharedState,
        getScrollX: () => scrollX,
        getScrollY: () => scrollY,
        getForEachUserComponents: () => forEachUserComponents,

        handlePlayerJoined: (user) => {
            const existing = presenceUsers.get(user.id);
            const sharedState: Record<string, unknown> = { ...(existing?.sharedState ?? {}) };
            if (user.avatar !== undefined) sharedState.avatar = user.avatar;
            if (user.cursorState !== undefined) sharedState.cursorState = user.cursorState;
            presenceUsers.set(user.id, {
                id: user.id,
                worldX: existing?.worldX ?? user.position?.x ?? 0,
                worldY: existing?.worldY ?? user.position?.y ?? 0,
                sharedState,
            });
        },
        handlePlayerLeft: (userId) => {
            presenceUsers.delete(userId);
        },
        handleCursorMoved: (userId, position, sharedState) => {
            const entry = presenceUsers.get(userId);
            if (!entry) return;
            entry.worldX = position.x;
            entry.worldY = position.y;
            if (sharedState) Object.assign(entry.sharedState, sharedState);
        },
        handleScrollInput: (x, y, now) => {
            scrollX = x;
            scrollY = y;
            trySendPosition(localViewportX + x, localViewportY + y, now);
        },
        handleMouseMoveInput: (viewportX, viewportY, now) => {
            localViewportX = viewportX;
            localViewportY = viewportY;
            trySendPosition(viewportX + scrollX, viewportY + scrollY, now);
        },
        handlePresenceSharedState: (userId, sharedState) => {
            const entry = presenceUsers.get(userId);
            if (entry) Object.assign(entry.sharedState, sharedState);
        },
    };
}
