import { randomUUID } from 'node:crypto';
import type { WorldEntity } from '@ubichill/shared';
import { logger } from '../utils/logger';

/**
 * インスタンスごとのエンティティ状態を管理するインメモリストア
 *
 * 設計思想:
 * - ワールド定義（YAML/DB）とは独立したランタイム状態
 * - バックエンドは「土管」として動作し、data の中身を解釈しない
 * - 各インスタンスは独立したエンティティ空間を持つ
 * - エンティティはインスタンスID + エンティティIDで一意に識別される
 */

// instanceId → entityId → WorldEntity のネストした Map
const instanceStates: Map<string, Map<string, WorldEntity>> = new Map();

function getInstanceEntityMap(instanceId: string): Map<string, WorldEntity> {
    let state = instanceStates.get(instanceId);
    if (!state) {
        state = new Map();
        instanceStates.set(instanceId, state);
        logger.debug(`インスタンス ${instanceId} のエンティティ状態を初期化しました`);
    }
    return state;
}

/**
 * 指定インスタンスの全エンティティを配列で取得
 */
export function getInstanceSnapshot(instanceId: string): WorldEntity[] {
    return Array.from(getInstanceEntityMap(instanceId).values());
}

/**
 * 新しいエンティティを作成
 */
export function createEntity(instanceId: string, entityData: Omit<WorldEntity, 'id'>): WorldEntity {
    const state = getInstanceEntityMap(instanceId);
    const entity: WorldEntity = { ...entityData, id: randomUUID() };
    state.set(entity.id, entity);
    logger.debug(`エンティティ作成: ${entity.id} (type: ${entity.type}, instance: ${instanceId})`);
    return entity;
}

/**
 * エンティティを部分更新（transform は深くマージ）
 */
export function patchEntity(
    instanceId: string,
    entityId: string,
    patch: Partial<Omit<WorldEntity, 'id' | 'type'>>,
): WorldEntity | null {
    const state = getInstanceEntityMap(instanceId);
    const entity = state.get(entityId);
    if (!entity) {
        logger.debug(`パッチ対象のエンティティが見つかりません: ${entityId}`);
        return null;
    }
    const updated: WorldEntity = {
        ...entity,
        ...patch,
        transform: patch.transform ? { ...entity.transform, ...patch.transform } : entity.transform,
    };
    state.set(entityId, updated);
    logger.debug(`エンティティ更新: ${entityId}`);
    return updated;
}

/**
 * エンティティを削除
 */
export function deleteEntity(instanceId: string, entityId: string): boolean {
    const state = getInstanceEntityMap(instanceId);
    const deleted = state.delete(entityId);
    logger.debug(deleted ? `エンティティ削除: ${entityId}` : `削除対象のエンティティが見つかりません: ${entityId}`);
    return deleted;
}

/**
 * エンティティを取得
 */
export function getEntity(instanceId: string, entityId: string): WorldEntity | undefined {
    return getInstanceEntityMap(instanceId).get(entityId);
}

/**
 * インスタンスのエンティティ状態をクリア（インスタンス終了時）
 */
export function clearInstanceState(instanceId: string): void {
    instanceStates.delete(instanceId);
    logger.debug(`インスタンス ${instanceId} のエンティティ状態をクリアしました`);
}
