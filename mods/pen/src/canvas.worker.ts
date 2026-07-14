/**
 * pen:canvas Worker — 描画レイヤー本体。
 *
 * ペンの選択ロジックは pen:pen Worker 側で完結している。canvas は:
 *   1. ワールド全体の pen:pen を watch して「自分のユーザーが保持中のペン」を 1 本特定
 *   2. マウス入力で stroke を組み立て
 *   3. 完成 stroke を canvas にコミット + broadcast + pen:stroke Entity として永続化
 *   4. canvas frame に active stroke と全ユーザーぶんのペンカーソルを描画
 *      (リモートユーザーが保持中のペンも presence の worldX/Y で位置同期される)
 *
 * pen:stroke は描いたペン Entity の子として生成される (parentEntityId = heldPen.entityId)。
 */

import type { CanvasStrokeData, Entity, System } from '@ubichill/sdk';
import { PenEvents } from './events';

// ────────────────────────────────────────────────────────────────
// 定数
// ────────────────────────────────────────────────────────────────

const CANVAS_TARGET = 'drawing';
const MAX_FINGERPRINT_CACHE = 200;

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
    isDrawing: false,
    currentStroke: [] as Array<[x: number, y: number, pressure: number]>,
    cursorX: 0,
    cursorY: 0,
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
// fingerprint (重複描画防止)
// ────────────────────────────────────────────────────────────────
// 自分の stroke を即時 commit したあと、broadcast / entity:pen:stroke 経由でも届く。
// 同じ stroke を何度も commit しないよう fingerprint で照合する。

const committedFingerprints = new Set<string>();
const drawnEntityIds = new Set<string>();

const strokeFingerprint = (data: CanvasStrokeData): string => {
    const p0 = data.points[0];
    return `${data.color}|${data.size}|${data.points.length}|${p0?.[0] ?? 0},${p0?.[1] ?? 0}`;
};

const addFingerprint = (fp: string): void => {
    if (committedFingerprints.size >= MAX_FINGERPRINT_CACHE) {
        const oldest = committedFingerprints.values().next().value;
        if (oldest !== undefined) committedFingerprints.delete(oldest);
    }
    committedFingerprints.add(fp);
};

const popFingerprintIfExists = (fp: string): boolean => {
    if (!committedFingerprints.has(fp)) return false;
    committedFingerprints.delete(fp);
    return true;
};

// ────────────────────────────────────────────────────────────────
// レンダリングヘルパー
// ────────────────────────────────────────────────────────────────

const buildActiveStroke = (): CanvasStrokeData | null => {
    if (!draw.local.isDrawing || draw.local.currentStroke.length <= 1) return null;
    return { points: draw.local.currentStroke, color: draw.local.color, size: draw.local.strokeWidth };
};

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
    for (const [userId, info] of remoteHeld) {
        if (info.penId === pen.id) {
            remoteHeld.delete(userId);
            break;
        }
    }
    // 現在リモートユーザーが持っているなら登録
    if (pen.lockedBy && pen.lockedBy !== Ubi.myUserId) {
        remoteHeld.set(pen.lockedBy, {
            penId: pen.id,
            color: pen.data.color ?? '#000000',
            strokeWidth: pen.data.strokeWidth ?? 4,
        });
    }
});

PenEvents.on('input:mouse_move', ({ x, y, buttons }) => {
    if (draw.local.heldPenId === null) return;
    draw.local.cursorX = x;
    draw.local.cursorY = y;
    if (draw.local.isDrawing && buttons & 1) draw.local.currentStroke.push([x, y, 1]);
});

PenEvents.on('input:mouse_down', ({ x, y, button }) => {
    if (draw.local.heldPenId === null || button !== 0) return;
    draw.batch(() => {
        draw.local.isDrawing = true;
        draw.local.currentStroke = [[x, y, 1]];
    });
});

PenEvents.on('input:mouse_up', ({ button }) => {
    if (draw.local.heldPenId === null || button !== 0) return;
    draw.local.isDrawing = false;
});

PenEvents.onBroadcast('pen:stroke_complete', (_userId, data) => {
    Ubi.canvas.commitStroke(CANVAS_TARGET, data);
    addFingerprint(strokeFingerprint(data));
});

PenEvents.on('entity:pen:stroke', (entity) => {
    if (drawnEntityIds.has(entity.id)) return;
    drawnEntityIds.add(entity.id);
    if (!popFingerprintIfExists(strokeFingerprint(entity.data))) {
        Ubi.canvas.commitStroke(CANVAS_TARGET, entity.data);
    }
});

// マウス up で stroke が確定したらコミット + 永続化
const flushCompletedStroke = (): void => {
    if (draw.local.isDrawing || draw.local.currentStroke.length <= 1) return;
    const strokeData: CanvasStrokeData = {
        points: draw.local.currentStroke.slice(),
        color: draw.local.color,
        size: draw.local.strokeWidth,
    };
    draw.local.currentStroke = [];

    Ubi.canvas.commitStroke(CANVAS_TARGET, strokeData);
    addFingerprint(strokeFingerprint(strokeData));
    PenEvents.broadcast('pen:stroke_complete', strokeData);

    const parentEntityId = draw.local.heldPenEntityId ?? undefined;
    const strokeEntityId = parentEntityId ? `stroke-${crypto.randomUUID()}` : undefined;
    Ubi.entity
        .spawn({
            type: 'pen:stroke',
            entityId: strokeEntityId,
            parentEntityId,
            ownerId: null,
            lockedBy: null,
            transform: { x: 0, y: 0, z: 0, w: 0, h: 0, scale: 1, rotation: 0 },
            data: strokeData,
        })
        .catch((err: unknown) => Ubi.log(`[pen:canvas] 永続化失敗: ${String(err)}`, 'warn'));
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
