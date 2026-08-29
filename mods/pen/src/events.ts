/**
 * pen mod Worker 間/Host 間通信の単一スキーマ。
 *
 * - on()          : emit / sendToHost / SDK 由来 (input:* / entity:* など) を受信
 * - onBroadcast() : 別ユーザーの Worker からの broadcast を受信 (payload は data のみ)
 * - emit / broadcast / sendToHost : 送信
 */

import type {
    CanvasStrokeData,
    ComponentInstance,
    InputMouseDownData,
    InputMouseMoveData,
    InputMouseUpData,
} from 'ubichill';

interface PenPenData {
    color?: string;
    strokeWidth?: number;
}

export const PenEvents = Ubi.event.define<{
    // ── SDK 由来: マウス入力 (input:*) ──
    'input:mouse_move': InputMouseMoveData;
    'input:mouse_down': InputMouseDownData;
    'input:mouse_up': InputMouseUpData;
    // ── SDK 由来: Entity watch (entity:<componentType>) ──
    'entity:pen:pen': ComponentInstance<PenPenData> | undefined;
    'entity:pen:stroke': ComponentInstance<CanvasStrokeData>;
    // ── 自mod: ペン → canvas への描画点。座標は「ペン先の位置」で、カーソル位置ではない。
    // ペンの形状・持ち方を知っているのはペン本体だけなので、ペン先の算出はペン側の責務にし、
    // canvas は受け取った点をそのまま線にする（持ち方を変えても線はペン先から出る）。
    'pen:draw:down': { x: number; y: number };
    'pen:draw:move': { x: number; y: number };
    'pen:draw:up': Record<string, never>;
    // ── 自mod: cross-user 描画イベント (broadcast) ──
    'pen:stroke_complete': CanvasStrokeData;
    // ── 自mod: tray クリック → ローカルのペンをトレイ上のクリック位置に置く ──
    'pen:tray:release': { x: number; y: number };
    // ── 自mod: tray で太さを変更 ──
    'pen:tray:change_thickness': { thickness: number };
}>();
