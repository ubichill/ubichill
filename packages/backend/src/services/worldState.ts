import { randomUUID } from 'node:crypto';
import type { WorldEntity } from '@ubichill/shared';
import { logger } from '../utils/logger';

/**
 * ルームごとのワールド状態を管理するインメモリストア
 *
 * 設計思想:
 * - バックエンドは「土管」として動作し、dataの中身を解釈しない
 * - 各ルームは独立したエンティティ空間を持つ
 * - エンティティはルームID + エンティティIDで一意に識別される
 */

// ルームID -> エンティティID -> エンティティ のネストしたMap
const worldStates: Map<string, Map<string, WorldEntity>> = new Map();

/**
 * 指定ルームのワールド状態を取得（なければ作成）
 */
export function getWorldState(roomId: string): Map<string, WorldEntity> {
    let roomState = worldStates.get(roomId);
    if (!roomState) {
        roomState = new Map();
        worldStates.set(roomId, roomState);
        logger.debug(`ルーム ${roomId} のワールド状態を初期化しました`);
    }
    return roomState;
}

/**
 * 指定ルームの全エンティティを配列で取得
 */
export function getWorldSnapshot(roomId: string): WorldEntity[] {
    const roomState = getWorldState(roomId);
    return Array.from(roomState.values());
}

/**
 * 新しいエンティティを作成
 * @returns 作成されたエンティティ（IDが付与される）
 */
export function createEntity(roomId: string, entityData: Omit<WorldEntity, 'id'>): WorldEntity {
    const roomState = getWorldState(roomId);

    const entity: WorldEntity = {
        ...entityData,
        id: randomUUID(),
    };

    roomState.set(entity.id, entity);
    logger.debug(`エンティティ作成: ${entity.id} (type: ${entity.type}, room: ${roomId})`);

    return entity;
}

/**
 * エンティティを部分更新（パッチ）
 * @returns 更新後のエンティティ、存在しない場合はnull
 */
export function patchEntity(
    roomId: string,
    entityId: string,
    patch: Partial<Omit<WorldEntity, 'id' | 'type'>>,
): WorldEntity | null {
    const roomState = getWorldState(roomId);
    const entity = roomState.get(entityId);

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

    roomState.set(entityId, updatedEntity);
    logger.debug(`エンティティ更新: ${entityId}`);

    return updatedEntity;
}

/**
 * エンティティを削除
 * @returns 削除に成功したかどうか
 */
export function deleteEntity(roomId: string, entityId: string): boolean {
    const roomState = getWorldState(roomId);
    const deleted = roomState.delete(entityId);

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
export function getEntity(roomId: string, entityId: string): WorldEntity | undefined {
    const roomState = getWorldState(roomId);
    return roomState.get(entityId);
}

/**
 * ルームのワールド状態をクリア（テスト用）
 */
export function clearWorldState(roomId: string): void {
    worldStates.delete(roomId);
    logger.debug(`ルーム ${roomId} のワールド状態をクリアしました`);
}

/**
 * 全ルームのワールド状態をクリア（テスト用）
 */
export function clearAllWorldStates(): void {
    worldStates.clear();
    logger.debug('全ルームのワールド状態をクリアしました');
}
