/**
 * PenCanvasSystem
 *
 * ホスト側 Canvas への描画コマンドを送信する。
 *
 * 毎フレーム:
 * - 他ユーザーの揮発性ブロードキャスト（pen:stroke_complete）→ commitStroke + フィンガープリント記録
 * - watchEntityTypes 経由の永続ストローク（entity:pen:stroke）→ commitStroke（重複防止付き）
 * - Ubi.canvas.frame() でアクティブストローク + カーソルを送信
 *
 * 二重描画防止（penFingerprint.ts 共有モジュール）:
 * - PenSyncSystem: 自分のストロークをローカルコミット後に addCommittedFingerprint()
 * - 他ユーザーのブロードキャスト受信時にも addCommittedFingerprint()
 * - entity:pen:stroke 到着時に popCommittedFingerprint() でヒットすればスキップ
 */

import type { CanvasStrokeData, Entity, System, WorkerEvent, WorldEntity } from '@ubichill/sdk';
import { draw } from '../canvas.worker';
import { addCommittedFingerprint, popCommittedFingerprint, strokeFingerprint } from '../penFingerprint';

const CANVAS_TARGET = 'drawing';
const CURSOR_RADIUS = 4;

/** 描画済みストロークエンティティIDを記録（参加後の初期描画の重複防止） */
const _drawnEntityIds = new Set<string>();

export const PenCanvasSystem: System = (_entities: Entity[], _dt: number, events: WorkerEvent[]) => {
    for (const event of events) {
        // 他ユーザーの完成ストローク（揮発性ブロードキャスト）
        if (event.type === 'pen:stroke_complete') {
            const { data } = event.payload as { userId: string; data: CanvasStrokeData };
            Ubi.canvas.commitStroke(CANVAS_TARGET, data);
            addCommittedFingerprint(strokeFingerprint(data));
        }

        // watchEntityTypes 経由: 永続ストロークエンティティ（参加後の初期描画、または接続中の新規ストローク）
        if (event.type === 'entity:pen:stroke') {
            const entity = event.payload as WorldEntity<CanvasStrokeData>;
            if (!_drawnEntityIds.has(entity.id)) {
                _drawnEntityIds.add(entity.id);
                // PenSyncSystem（自分）またはブロードキャスト経由で既に描画済みならスキップ
                if (!popCommittedFingerprint(strokeFingerprint(entity.data))) {
                    Ubi.canvas.commitStroke(CANVAS_TARGET, entity.data);
                }
            }
        }
    }

    const isPenHeld = draw.local.heldPenId !== null;

    Ubi.canvas.frame(CANVAS_TARGET, {
        activeStroke:
            isPenHeld && draw.local.isDrawing && draw.local.currentStroke.length > 1
                ? { points: draw.local.currentStroke, color: draw.local.color, size: draw.local.strokeWidth }
                : null,
        cursor: isPenHeld
            ? {
                  x: draw.local.cursorX,
                  y: draw.local.cursorY,
                  color: draw.local.color,
                  size: Math.max(CURSOR_RADIUS * 2, draw.local.strokeWidth),
                  shape: 'custom' as const,
                  // 座標原点 = カーソル先端、45° 傾き
                  rotation: -Math.PI / 4,
                  pathFills: [
                      { d: 'M0,0 L-3,-8 L3,-8 Z', fill: '#888' },
                      { d: 'M-3,-32 h6 v24 h-6 Z', fill: draw.local.color },
                      { d: 'M-2,-30 h2 v18 h-2 Z', fill: 'rgba(255,255,255,0.25)' },
                      { d: 'M-1.5,0 a1.5,1.5 0 1,0 3,0 a1.5,1.5 0 1,0 -3,0', fill: '#333' },
                  ],
                  pathStrokes: [{ d: 'M-3,-32 h6 v24 h-6 Z', stroke: 'rgba(0,0,0,0.5)', lineWidth: 0.8 }],
              }
            : null,
    });
};
