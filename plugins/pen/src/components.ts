/**
 * Pen Plugin - Component Definitions
 *
 * canvas Worker 内のローカル ECS が使用するコンポーネント。
 * World Entity (pen:pen) はサーバー側の純粋データであり、
 * Worker はそれを監視して DrawState に反映する。
 */

import type { ComponentDefinition } from '@ubichill/sdk';

/**
 * DrawState Component — キャンバス Worker が管理する描画状態。
 *
 * - heldPenId: 現在「持っている」 pen:pen ワールドエンティティの ID（null = 未選択）
 * - color / strokeWidth: 保持ペンから同期される描画スタイル
 * - isDrawing / currentStroke: 入力システムが更新するストローク状態
 * - cursorX / cursorY: カーソル表示用の最新座標
 */
export interface DrawStateData {
    heldPenId: string | null;
    color: string;
    strokeWidth: number;
    isDrawing: boolean;
    currentStroke: Array<[x: number, y: number, pressure: number]>;
    cursorX: number;
    cursorY: number;
}

export const DrawState: ComponentDefinition<DrawStateData> = {
    name: 'DrawState' as const,
    default: {
        heldPenId: null,
        color: '#000000',
        strokeWidth: 4,
        isDrawing: false,
        currentStroke: [],
        cursorX: 0,
        cursorY: 0,
    },
};
