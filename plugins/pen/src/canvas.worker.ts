/**
 * Pen Plugin - Canvas Worker
 *
 * pen:canvas は描画レイヤーを担当する。ペンの選択ロジックはここにはなく、
 * 各 pen:pen Worker が所有する。canvas はその結果 (lockedBy) を watch して
 * 「いま自分のユーザーが持っているペンの色/太さ/Entity id」だけを引き出し、
 * 入力を受けて active stroke を構築・完成ストロークを pen:stroke として永続化する。
 *
 * pen:stroke は描いたペン Entity の子として生成される (parentEntityId = heldPen.entityId)。
 *
 * System 実行順:
 *   PenWatchSystem → PenInputSystem → PenSyncSystem → PenCanvasSystem
 */

import { PenCanvasSystem, PenInputSystem, PenSyncSystem, PenWatchSystem } from './systems';

export const draw = Ubi.state.define({
    /** 保持中ペンの ComponentInstance.id (Worker 識別子)。null なら未保持。 */
    heldPenId: null as string | null,
    /** 保持中ペンの Entity (GameObject) id。pen:stroke 作成時の parentEntityId に使う。 */
    heldPenEntityId: null as string | null,
    color: '#000000',
    strokeWidth: 4,
    isDrawing: false,
    currentStroke: [] as Array<[x: number, y: number, pressure: number]>,
    cursorX: 0,
    cursorY: 0,
});

Ubi.registerSystem(PenWatchSystem);
Ubi.registerSystem(PenInputSystem);
Ubi.registerSystem(PenSyncSystem);
Ubi.registerSystem(PenCanvasSystem);
