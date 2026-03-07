/**
 * Pen Plugin - Component Definitions
 *
 * Pen プラグインが使用するコンポーネントを定義します。
 * ECS World 内の Entity にこれらの Component が付与されます。
 */

import type { ComponentDefinition } from '@ubichill/sdk';

/**
 * Transform Component
 *
 * Entity の位置・サイズを表します。
 * ペンの場合は、カーソルの位置を管理します。
 */
export interface TransformData {
    x: number;
    y: number;
}

export const Transform: ComponentDefinition<TransformData> = {
    name: 'Transform' as const,
    default: {
        x: 0,
        y: 0,
    },
};

/**
 * Pen State Component
 *
 * ペンの状態を管理します：描画中か、色、現在のストロークなど。
 */
export interface PenStateData {
    /** 現在、描画中か */
    isDrawing: boolean;

    /** ペンの色 */
    color: string;

    /** ストロークの幅 */
    strokeWidth: number;

    /** 描画中の現在のストローク（座標の配列） */
    currentStroke: Array<[x: number, y: number, pressure: number]>;

    /** マウスボタン状態（0 = 押されていない） */
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
 * Sync Component
 *
 * Host との通信状態を管理します。
 * 次のフレームで Host へ送信するべきイベントを記録します。
 */
export interface SyncStateData {
    /** Host へ送信する待機中のイベント */
    pendingMessages: Array<{
        type: 'DRAWING_UPDATE' | 'STROKE_COMPLETE' | 'DRAWING_CLEAR';
        payload: unknown;
    }>;

    /** 最後に Host へ送信した時刻 */
    lastSyncTime: number;
}

export const SyncState: ComponentDefinition<SyncStateData> = {
    name: 'SyncState' as const,
    default: {
        pendingMessages: [],
        lastSyncTime: 0,
    },
};
