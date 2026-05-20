/**
 * PenCanvasSystem — ホスト側 Canvas への描画コマンドを送信する。
 *
 * 毎フレーム:
 * - 'pen:stroke_complete' 揮発性ブロードキャスト → commitStroke + fingerprint 記録
 * - 'entity:pen:stroke' 永続化エンティティ → commitStroke (fingerprint で重複防止)
 * - Ubi.canvas.frame() で active stroke + カーソルを送信
 *
 * 二重描画防止 (penFingerprint):
 * - 自分の commit 時に addCommittedFingerprint
 * - entity:pen:stroke 受信時に popCommittedFingerprint でヒットすればスキップ
 */

import type { CanvasCursorData, CanvasStrokeData, ComponentInstance, Entity, System, WorkerEvent } from '@ubichill/sdk';
import { draw } from '../canvas.worker';
import { addCommittedFingerprint, popCommittedFingerprint, strokeFingerprint } from '../penFingerprint';

const CANVAS_TARGET = 'drawing';
const CURSOR_RADIUS = 4;

/** カーソル形状の不変パス (色のみフレーム毎に差し替え) */
const CURSOR_FIXED_FILLS = [
    { d: 'M0,0 L-3,-8 L3,-8 Z', fill: '#888' },
    { d: 'M-2,-30 h2 v18 h-2 Z', fill: 'rgba(255,255,255,0.25)' },
    { d: 'M-1.5,0 a1.5,1.5 0 1,0 3,0 a1.5,1.5 0 1,0 -3,0', fill: '#333' },
] as const;
const CURSOR_STROKES = [{ d: 'M-3,-32 h6 v24 h-6 Z', stroke: 'rgba(0,0,0,0.5)', lineWidth: 0.8 }] as const;

/** 描画済みストローク Entity の id 集合 (参加後の初期再生 + 接続中重複の両方を抑止) */
const drawnEntityIds = new Set<string>();

const handleEvent = (event: WorkerEvent): void => {
    if (event.type === 'pen:stroke_complete') {
        const { data } = event.payload as { userId: string; data: CanvasStrokeData };
        Ubi.canvas.commitStroke(CANVAS_TARGET, data);
        addCommittedFingerprint(strokeFingerprint(data));
        return;
    }
    if (event.type === 'entity:pen:stroke') {
        const entity = event.payload as ComponentInstance<CanvasStrokeData>;
        if (drawnEntityIds.has(entity.id)) return;
        drawnEntityIds.add(entity.id);
        if (!popCommittedFingerprint(strokeFingerprint(entity.data))) {
            Ubi.canvas.commitStroke(CANVAS_TARGET, entity.data);
        }
    }
};

const buildCursor = (): CanvasCursorData => ({
    x: draw.local.cursorX,
    y: draw.local.cursorY,
    color: draw.local.color,
    size: Math.max(CURSOR_RADIUS * 2, draw.local.strokeWidth),
    shape: 'custom',
    rotation: -Math.PI / 4,
    pathFills: [...CURSOR_FIXED_FILLS, { d: 'M-3,-32 h6 v24 h-6 Z', fill: draw.local.color }],
    pathStrokes: [...CURSOR_STROKES],
});

const buildActiveStroke = (): CanvasStrokeData | null => {
    if (!draw.local.isDrawing || draw.local.currentStroke.length <= 1) return null;
    return { points: draw.local.currentStroke, color: draw.local.color, size: draw.local.strokeWidth };
};

export const PenCanvasSystem: System = (_entities: Entity[], _dt: number, events: WorkerEvent[]) => {
    for (const event of events) handleEvent(event);

    const isPenHeld = draw.local.heldPenId !== null;
    Ubi.canvas.frame(CANVAS_TARGET, {
        activeStroke: isPenHeld ? buildActiveStroke() : null,
        cursor: isPenHeld ? buildCursor() : null,
    });
};
