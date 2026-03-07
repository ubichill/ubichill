/**
 * Pen Plugin - Worker Implementation (ECS-based)
 *
 * Worker（Sandbox）内で動作する Pen ツールのロジック。
 * ECS (Entity Component System) アーキテクチャに基づいています。
 *
 * 【実行フロー】
 * 1. Host が `EVT_LIFECYCLE_INIT` でこのコードを Worker に送信
 * 2. Ubi がこのモジュールを読み込み、System を登録
 * 3. 毎フレーム： Input System → Sync System の順で実行
 * 4. Pen Entity の状態が更新される
 * 5. Sync System が Host へメッセージを送信
 */

import type { Entity } from '@ubichill/sdk';
import { PenInputSystem } from './systems/PenInputSystem';
import { PenSyncSystem } from './systems/PenSyncSystem';
import { PenState, SyncState, Transform } from './components';

/**
 * Worker 内で自動注入される
 */
declare global {
    const Ubi: any;
}

// ===== Initialization =====

if (typeof Ubi !== 'undefined') {
    // 1. Pen Entity を作成
    const penEntity = Ubi.world.createEntity('pen-main');
    penEntity.setComponent(Transform.name, { ...Transform.default });
    penEntity.setComponent(PenState.name, { ...PenState.default });
    penEntity.setComponent(SyncState.name, { ...SyncState.default });

    // 2. System を登録（実行順序: Input → Sync）
    Ubi.registerSystem(PenInputSystem);
    Ubi.registerSystem(PenSyncSystem);

    // デバッグ用
    console.log('[Pen Worker] Initialized. Entity created and systems registered.');
}

// ===== Exports =====

export type { PenHostMessage, PenMessagingSchema, PenWorkerMessage } from './types';
