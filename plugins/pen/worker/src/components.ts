/**
 * Pen Plugin - Component Definitions
 *
 * Pen プラグインが使用するコンポーネントを定義します。
 * ECS World 内の Entity にこれらの Component が付与されます。
 */

import type { ComponentDefinition } from '@ubichill/sdk';

/**
 * Transform Component — Entity の位置。ペンカーソルの座標を管理する。
 */
export interface TransformData {
    x: number;
    y: number;
}

export const Transform: ComponentDefinition<TransformData> = {
    name: 'Transform' as const,
    default: { x: 0, y: 0 },
};

/**
 * PenState Component — 描画状態（ボタン押下・現在のストローク）を管理する。
 */
export interface PenStateData {
    isDrawing: boolean;
    color: string;
    strokeWidth: number;
    /** 描画中のストローク座標リスト */
    currentStroke: Array<[x: number, y: number, pressure: number]>;
    mouseButtons: number;
}

export const PenState: ComponentDefinition<PenStateData> = {
    name: 'PenState' as const,
    default: {
        isDrawing: false,
        color: '#000000',
        strokeWidth: 4,
        currentStroke: [],
        mouseButtons: 0,
    },
};

/**
 * SyncState Component — Host との同期スロットリング状態を管理する。
 */
export interface SyncStateData {
    /** 最後に Host へ DRAWING_UPDATE を送信した時刻 */
    lastSyncTime: number;
}

export const SyncState: ComponentDefinition<SyncStateData> = {
    name: 'SyncState' as const,
    default: {
        lastSyncTime: 0,
    },
};
