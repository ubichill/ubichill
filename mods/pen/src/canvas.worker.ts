/**
 * pen:canvas Worker — 描画レイヤー本体。
 *
 * ペンの選択ロジックは pen:pen Worker 側で完結している。canvas は:
 *   1. ワールド全体の pen:pen を watch して「自分のユーザーが保持中のペン」を 1 本特定
 *   2. pen:pen から届くペン先座標 (pen:draw:*) で stroke を組み立て
 *   3. 完成 stroke を canvas にコミット + pen:stroke Entity として永続化（他人には Entity として届く）。
 *      重ねる順は pen:stroke が届いた順に揃える（strokeOrder.ts）
 *   4. canvas frame に active stroke と全ユーザーぶんのペンカーソルを描画
 *      (リモートユーザーが保持中のペンも presence の worldX/Y で位置同期される)
 *
 * pen:stroke は描いたペン Entity の子として生成される (parentEntityId = heldPen.entityId)。
 */

import type { CanvasStrokeData, ComponentConfig, Entity, System } from 'ubichill';
import { PenEvents } from './events';
import { buildStroke, extendStroke, type PenStrokeData, parseStroke, type StrokePoint, strokeIdOf } from './stroke';
import {
    type CanvasUpdate,
    confirmStroke,
    drawPending,
    dropPending,
    EMPTY_STROKE_ORDER,
    type StrokeOrder,
    type StrokeOrderStep,
} from './strokeOrder';

export const config: ComponentConfig = {
    canvasTargets: ['drawing'],
    watchEntityTypes: ['pen:stroke', 'pen:pen'],
    watchScope: 'world',
    defaultTransform: { x: 0, y: 0, z: 5000 },
    capabilities: ['canvas:draw', 'event:emit', 'scene:read', 'scene:update'],
};

// ────────────────────────────────────────────────────────────────
// 定数
// ────────────────────────────────────────────────────────────────

const CANVAS_TARGET = 'drawing';

// ────────────────────────────────────────────────────────────────
// 状態 (Ubi.state)
// ────────────────────────────────────────────────────────────────

const draw = Ubi.state.define({
    /** 保持中ペンの ComponentInstance.id (Worker 識別子)。null なら未保持。 */
    heldPenId: null as string | null,
    /** 保持中ペンの Entity (GameObject) id。stroke の親に使う。 */
    heldPenEntityId: null as string | null,
    color: '#000000',
    strokeWidth: 4,
    /** 保持中の pen:pen が消しゴム (data.eraser) か。 */
    eraser: false,
    isDrawing: false,
    currentStroke: [] as StrokePoint[],
    /** キャンバスに重ねたストロークの順。 */
    strokes: EMPTY_STROKE_ORDER as StrokeOrder,
});

// ────────────────────────────────────────────────────────────────
// リモートで保持されているペン (userId → 表示用情報)
// presence の worldX/Y と合成してペンカーソルを描画する。
// ────────────────────────────────────────────────────────────────
interface RemotePenInfo {
    penId: string;
    color: string;
    strokeWidth: number;
}
const remoteHeld = new Map<string, RemotePenInfo>();

// ────────────────────────────────────────────────────────────────
// 確定したストローク
// ────────────────────────────────────────────────────────────────

// watch は同じ Entity を送り直すことがある（更新・Worker の起動し直し）ので、1 つの Entity は 1 回だけ重ねる
const drawnEntityIds = new Set<string>();

const applyCanvasUpdate = (update: CanvasUpdate): void => {
    if (update.kind === 'append') Ubi.canvas.commitStroke(CANVAS_TARGET, update.stroke);
    else if (update.kind === 'redraw') Ubi.canvas.replaceStrokes(CANVAS_TARGET, update.strokes);
};

const applyStrokeStep = (step: StrokeOrderStep): void => {
    draw.local.strokes = step.order;
    applyCanvasUpdate(step.update);
};

// ────────────────────────────────────────────────────────────────
// レンダリングヘルパー
// ────────────────────────────────────────────────────────────────

const heldTool = () => ({ color: draw.local.color, strokeWidth: draw.local.strokeWidth, eraser: draw.local.eraser });

const buildActiveStroke = (): CanvasStrokeData | null =>
    draw.local.isDrawing ? buildStroke(draw.local.currentStroke, heldTool()) : null;

// ────────────────────────────────────────────────────────────────
// イベント受信
// ────────────────────────────────────────────────────────────────

PenEvents.on('entity:pen:pen', (pen) => {
    if (!pen) return;
    const isHeldByMe = pen.lockedBy === Ubi.myUserId;
    if (isHeldByMe) {
        if (draw.local.heldPenId !== pen.id) {
            draw.batch(() => {
                draw.local.isDrawing = false;
                draw.local.currentStroke = [];
            });
        }
        draw.batch(() => {
            draw.local.heldPenId = pen.id;
            draw.local.heldPenEntityId = pen.entityId ?? null;
            if (pen.data.color !== undefined) draw.local.color = pen.data.color;
            if (pen.data.strokeWidth !== undefined) draw.local.strokeWidth = pen.data.strokeWidth;
            draw.local.eraser = pen.data.eraser === true;
        });
    } else if (pen.id === draw.local.heldPenId) {
        draw.batch(() => {
            draw.local.heldPenId = null;
            draw.local.heldPenEntityId = null;
            draw.local.isDrawing = false;
            draw.local.currentStroke = [];
        });
    }

    // ── リモート保持の追跡 ─────────────────────────────────
    // この pen が以前どのリモートユーザーに紐付いていたら一旦消す
    remoteHeld.forEach((info, userId) => {
        if (info.penId === pen.id) remoteHeld.delete(userId);
    });
    // 現在リモートユーザーが持っているなら登録
    if (pen.lockedBy && pen.lockedBy !== Ubi.myUserId) {
        remoteHeld.set(pen.lockedBy, {
            penId: pen.id,
            color: pen.data.color ?? '#000000',
            strokeWidth: pen.data.strokeWidth ?? 4,
        });
    }
});

// 座標は「ペン先の位置」として pen:pen から届く（カーソル位置ではない）。
// どこから線が出るかはペンの形状と持ち方で決まり、それを知っているのはペン本体だけなので、
// canvas は受け取った点をそのまま線にする。
PenEvents.on('pen:draw:down', ({ x, y }) => {
    if (draw.local.heldPenId === null) return;
    draw.batch(() => {
        draw.local.isDrawing = true;
        draw.local.currentStroke = [[x, y, 1]];
    });
});

PenEvents.on('pen:draw:move', ({ x, y }) => {
    if (!draw.local.isDrawing) return;
    const { points, full } = extendStroke(draw.local.currentStroke, [x, y, 1]);
    draw.local.currentStroke = points;
    if (full) completeStroke(full);
});

PenEvents.on('pen:draw:up', () => {
    draw.local.isDrawing = false;
});

// pen:stroke の data は改造したクライアントも書けるので、検証を通ったものだけ描く
PenEvents.on('entity:pen:stroke', (entity) => {
    if (drawnEntityIds.has(entity.id)) return;
    drawnEntityIds.add(entity.id);
    const stroke = parseStroke(entity.data);
    if (!stroke) return;
    applyStrokeStep(confirmStroke(draw.local.strokes, stroke, strokeIdOf(entity.data)));
});

// 確定した 1 本を先に描き、pen:stroke として保存する。保存できなければ自分の画面からも消す
const completeStroke = (points: readonly StrokePoint[]): void => {
    const stroke = buildStroke(points, heldTool());
    if (!stroke) return;
    const strokeId = crypto.randomUUID();
    applyStrokeStep(drawPending(draw.local.strokes, { strokeId, stroke }));

    const parentEntityId = draw.local.heldPenEntityId ?? undefined;
    const data: PenStrokeData = { ...stroke, strokeId };
    Ubi.entity
        .spawn({
            type: 'pen:stroke',
            entityId: parentEntityId ? `stroke-${strokeId}` : undefined,
            parentEntityId,
            ownerId: null,
            lockedBy: null,
            transform: { x: 0, y: 0, z: 0, w: 0, h: 0, scale: 1, rotation: 0 },
            data,
        })
        .catch((err: unknown) => {
            Ubi.log(`[pen:canvas] 永続化失敗: ${String(err)}`, 'warn');
            applyStrokeStep(dropPending(draw.local.strokes, strokeId));
        });
};

// pen:draw:up で描き終えたら確定する
const flushCompletedStroke = (): void => {
    if (draw.local.isDrawing || draw.local.currentStroke.length === 0) return;
    const points = draw.local.currentStroke;
    draw.local.currentStroke = [];
    completeStroke(points);
};

// ────────────────────────────────────────────────────────────────
// 毎フレーム描画: 完成 stroke flush + canvas frame
// ────────────────────────────────────────────────────────────────

const FrameSystem: System = (_entities: Entity[]) => {
    flushCompletedStroke();

    Ubi.canvas.frame(CANVAS_TARGET, {
        activeStroke: buildActiveStroke(),
        cursors: [], // ペン本体（pen:pen）が追従するため、キャンバス側でのダミーカーソル描画は不要
    });
};

Ubi.registerSystem(FrameSystem);
