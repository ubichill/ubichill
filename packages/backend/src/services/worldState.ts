import { randomUUID } from 'node:crypto';
import type { WorldEntity } from '@ubichill/shared';
import { logger } from '../utils/logger';

/**
 * インスタンスごとのワールド状態を管理するインメモリストア
 *
 * 設計思想:
 * - バックエンドは「土管」として動作し、dataの中身を解釈しない
 * - 各インスタンスは独立したエンティティ空間を持つ
 * - エンティティはインスタンスID + エンティティIDで一意に識別される
 */

// インスタンスID -> エンティティID -> エンティティ のネストしたMap
const worldStates: Map<string, Map<string, WorldEntity>> = new Map();

/**
 * 指定インスタンスのワールド状態を取得（なければ作成）
 */
export function getWorldState(instanceId: string): Map<string, WorldEntity> {
    let instanceState = worldStates.get(instanceId);
    if (!instanceState) {
        instanceState = new Map();
        worldStates.set(instanceId, instanceState);
        logger.debug(`インスタンス ${instanceId} のワールド状態を初期化しました`);
    }
    return instanceState;
}

/**
 * 指定インスタンスの全エンティティを配列で取得
 */
export function getWorldSnapshot(instanceId: string): WorldEntity[] {
    const instanceState = getWorldState(instanceId);
    return Array.from(instanceState.values());
}

/**
 * 新しいエンティティを作成
 * @returns 作成されたエンティティ（IDが付与される）
 */
export function createEntity(instanceId: string, entityData: Omit<WorldEntity, 'id'>): WorldEntity {
    const instanceState = getWorldState(instanceId);

    const entity: WorldEntity = {
        ...entityData,
        id: randomUUID(),
    };

    instanceState.set(entity.id, entity);
    logger.debug(`エンティティ作成: ${entity.id} (type: ${entity.type}, instance: ${instanceId})`);

    return entity;
}

/**
 * エンティティを部分更新（パッチ）
 * @returns 更新後のエンティティ、存在しない場合はnull
 */
export function patchEntity(
    instanceId: string,
    entityId: string,
    patch: Partial<Omit<WorldEntity, 'id' | 'type'>>,
): WorldEntity | null {
    const instanceState = getWorldState(instanceId);
    const entity = instanceState.get(entityId);

    if (!entity) {
        logger.debug(`パッチ対象のエンティティが見つかりません: ${entityId}`);
        return null;
    }

    // transformの部分更新をサポート
    const updatedEntity: WorldEntity = {
        ...entity,
        ...patch,
        transform: patch.transform ? { ...entity.transform, ...patch.transform } : entity.transform,
    };

    instanceState.set(entityId, updatedEntity);
    logger.debug(`エンティティ更新: ${entityId}`);

    return updatedEntity;
}

/**
 * エンティティを削除
 * @returns 削除に成功したかどうか
 */
export function deleteEntity(instanceId: string, entityId: string): boolean {
    const instanceState = getWorldState(instanceId);
    const deleted = instanceState.delete(entityId);

    if (deleted) {
        logger.debug(`エンティティ削除: ${entityId}`);
    } else {
        logger.debug(`削除対象のエンティティが見つかりません: ${entityId}`);
    }

    return deleted;
}

/**
 * エンティティを取得
 */
export function getEntity(instanceId: string, entityId: string): WorldEntity | undefined {
    const instanceState = getWorldState(instanceId);
    return instanceState.get(entityId);
}

/**
 * インスタンスのワールド状態をクリア
 */
export function clearWorldState(instanceId: string): void {
    worldStates.delete(instanceId);
    logger.debug(`インスタンス ${instanceId} のワールド状態をクリアしました`);
}

/**
 * 全インスタンスのワールド状態をクリア（テスト用）
 */
export function clearAllWorldStates(): void {
    worldStates.clear();
    logger.debug('全インスタンスのワールド状態をクリアしました');
}
