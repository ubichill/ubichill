/**
 * Pen Plugin - Worker Entry Point (ECS-based)
 *
 * このファイルは sandbox.worker.ts によって Sandbox 内で実行される。
 * `Ubi` は SafeFunction('Ubi', code)(Ubi) で注入済みのため、
 * 実行時に必ず存在する。typeof チェックは不要。
 *
 * 実行フロー:
 * 1. Host が EVT_LIFECYCLE_INIT でこのバンドル済みコードを Worker へ送信
 * 2. Ubi が注入された状態でこのスクリプトが実行される
 * 3. Entity 作成・System 登録が完了
 * 4. 毎フレーム: PenInputSystem → PenSyncSystem の順で実行
 */

import { PenState, SyncState, Transform } from './components';
import { PenInputSystem } from './systems/PenInputSystem';
import { PenSyncSystem } from './systems/PenSyncSystem';

const penEntity = Ubi.world.createEntity('pen-main');
penEntity.setComponent(Transform.name, { ...Transform.default });
penEntity.setComponent(PenState.name, { ...PenState.default });
penEntity.setComponent(SyncState.name, { ...SyncState.default });

Ubi.registerSystem(PenInputSystem);
Ubi.registerSystem(PenSyncSystem);

console.log('[Pen Worker] Initialized. Entity created and systems registered.');

// 型エクスポート（esbuild でバンドルする際は除去される。TypeScript の型チェック用）
export type { PenWorkerMessage } from './types';
