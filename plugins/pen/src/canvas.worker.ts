/**
 * Pen Plugin - Canvas Worker Entry Point (ECS)
 *
 * pen:canvas エンティティに紐付くシングルトン Worker。
 * pen:pen エンティティは純粋なデータとしてワールドに存在し、
 * このWorkerが全ての pen:pen を監視して描画状態を管理する。
 *
 * ローカル ECS:
 *   draw-state エンティティ
 *     └ DrawState コンポーネント: 保持ペン・ストローク・カーソル状態
 *
 * System 実行順:
 *   PenWatchSystem → PenInputSystem → PenSyncSystem → PenCanvasSystem
 */

import { DrawState } from './components';
import { PenCanvasSystem, PenInputSystem, PenSyncSystem, PenWatchSystem } from './systems';

const drawEntity = Ubi.local.createEntity('draw-state');
drawEntity.setComponent(DrawState.name, { ...DrawState.default });

Ubi.registerSystem(PenWatchSystem);
Ubi.registerSystem(PenInputSystem);
Ubi.registerSystem(PenSyncSystem);
Ubi.registerSystem(PenCanvasSystem);

Ubi.log('[PenCanvas Worker] 初期化完了', 'info');
