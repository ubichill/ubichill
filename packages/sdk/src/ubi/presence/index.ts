import type { PresenceEntry, SendFn } from '../types';

export type PresenceModule = {
    // ── Public API ────────────────────────────────────────
    users(): ReadonlyMap<string, { worldX: number; worldY: number; viewportX: number; viewportY: number }>;
    scroll(): { readonly x: number; readonly y: number };
    syncPosition(options?: { throttleMs?: number }): void;
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

export function createPresenceModule(send: SendFn): PresenceModule {
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
            type: 'NETWORK_SEND_TO_HOST',
            payload: {
                type: 'position:update',
                data: { x: worldX, y: worldY, sharedState: localSharedState },
            },
        });
    };

    return {
        users: () => {
            const result = new Map<string, { worldX: number; worldY: number; viewportX: number; viewportY: number }>();
            for (const [id, entry] of presenceUsers) {
                result.set(id, {
                    worldX: entry.worldX,
                    worldY: entry.worldY,
                    viewportX: entry.worldX - scrollX,
                    viewportY: entry.worldY - scrollY,
                });
            }
            return result;
        },
        scroll: () => ({ x: scrollX, y: scrollY }),
        syncPosition: (options) => {
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
