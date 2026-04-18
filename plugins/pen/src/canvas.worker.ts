/**
 * Pen Plugin - Canvas Worker Entry Point (ECS)
 *
 * pen:canvas エンティティに紐付くシングルトン Worker。
 * 描画状態は Ubi.state.define で一元管理する（ローカルのみ、グローバル同期なし）。
 *
 * System 実行順:
 *   PenWatchSystem → PenInputSystem → PenSyncSystem → PenCanvasSystem
 */

import { PenCanvasSystem, PenInputSystem, PenSyncSystem, PenWatchSystem } from './systems';

export const draw = Ubi.state.define({
    heldPenId: null as string | null,
    color: '#000000',
    strokeWidth: 4,
    isDrawing: false,
    currentStroke: [] as Array<[x: number, y: number, pressure: number]>,
    cursorX: 0,
    cursorY: 0,
});
// 同期キーなし — 描画状態はローカル専用（ストロークは commitStroke / broadcast で別途共有）

Ubi.registerSystem(PenWatchSystem);
Ubi.registerSystem(PenInputSystem);
Ubi.registerSystem(PenSyncSystem);
Ubi.registerSystem(PenCanvasSystem);

Ubi.log('[PenCanvas Worker] 初期化完了', 'info');
