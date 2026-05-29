/**
 * HoldContext — 自分が「持っている」エンティティの状態を管理するコンテキスト。
 *
 * 責務:
 *  - Ubi.grip が CMD_GRIP_HOLD を送ってきたとき、held state を更新する
 *  - EntityRenderer はこのコンテキストを参照して、自分が持っているエンティティを
 *    cursor-fixed で描画する（DOM 直接操作・React re-render 不要）
 *  - useSocket().updatePosition に heldEntityId を含めて cursor:move で他ユーザーへ伝達
 */

import type { CmdGrip } from '@ubichill/shared';
import type React from 'react';
import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { heldEntitySyncRef } from '../heldEntitySyncRef';

export interface HoldState {
    /** 持っているエンティティの ComponentInstance ID */
    entityId: string;
    /** カーソル位置からの X オフセット (px) */
    offsetX: number;
    /** カーソル位置からの Y オフセット (px) */
    offsetY: number;
    /** スロット名（将来のアバターアタッチポイント用） */
    slot: string;
    /** 同期範囲 */
    share: 'local' | 'presence' | 'persistent';
    /** ホバー時のカーソル CSS */
    hoverCursor?: string;
    /** 保持時のカーソル CSS */
    heldCursor?: string;
}

interface HoldContextValue {
    /** 現在持っているエンティティの状態（null = 何も持っていない） */
    held: HoldState | null;
    /** 最新の held 状態を ref で取得（re-render なしで読める） */
    heldRef: React.RefObject<HoldState | null>;
    /** grip コマンドを処理してホールド状態を更新する */
    handleGripCommand(payload: CmdGrip['payload']): void;
}

const HoldContext = createContext<HoldContextValue | null>(null);

export const HoldProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [held, setHeld] = useState<HoldState | null>(null);
    const heldRef = useRef<HoldState | null>(null);
    // ホバーカーソル設定を保存（setHover は hold/release と別タイミングで届く）
    const pendingHoverRef = useRef<{ cursor: string; heldCursor: string } | null>(null);

    const handleGripCommand = useCallback((payload: CmdGrip['payload']) => {
        if (payload.action === 'hold') {
            const state: HoldState = {
                entityId: payload.entityId,
                offsetX: payload.offsetX,
                offsetY: payload.offsetY,
                slot: payload.slot,
                share: payload.share,
                hoverCursor: pendingHoverRef.current?.cursor,
                heldCursor: pendingHoverRef.current?.heldCursor,
            };
            heldRef.current = state;
            setHeld(state);
            // HoldProvider 外（router レベル）からも読めるよう同期
            heldEntitySyncRef.set({ entityId: payload.entityId, share: payload.share });
        } else if (payload.action === 'release') {
            heldRef.current = null;
            setHeld(null);
            heldEntitySyncRef.set(null);
        } else if (payload.action === 'setHover') {
            // hold より前に届くことがあるので pending に保存
            pendingHoverRef.current = { cursor: payload.cursor, heldCursor: payload.heldCursor };
            // 既に hold 中なら即時反映
            if (heldRef.current) {
                const updated: HoldState = {
                    ...heldRef.current,
                    hoverCursor: payload.cursor,
                    heldCursor: payload.heldCursor,
                };
                heldRef.current = updated;
                setHeld(updated);
            }
        }
    }, []);

    return <HoldContext.Provider value={{ held, heldRef, handleGripCommand }}>{children}</HoldContext.Provider>;
};

/** プロバイダが無い時に返す no-op フォールバック */
const NO_HOLD_CTX: HoldContextValue = {
    held: null,
    heldRef: { current: null },
    handleGripCommand: () => {
        /* no-op (HoldProvider 外で呼ばれた場合は何もしない) */
    },
};

/**
 * `HoldProvider` の外でも安全に使える。Provider が無い場合は no-op の状態を返す
 * (例: WorldEditor の Preview で EntityRenderer を使うが grip は使わない、というケース)。
 */
export function useHold(): HoldContextValue {
    const ctx = useContext(HoldContext);
    return ctx ?? NO_HOLD_CTX;
}
