import { randomUUID } from 'node:crypto';
import type { ComponentInstance } from '@ubichill/shared';
import { logger } from '../utils/logger';

/**
 * インスタンスごとの flat ComponentInstance 状態を管理するインメモリストア。
 *
 * 設計思想:
 * - ワールド定義（YAML/DB）は GameObject + components[] で表現されるが、
 *   ランタイム socket / SDK は引き続き flat ComponentInstance 単位で動く（Stage 1）。
 *   GameObject の flatten は `instanceManager` 側で行う。
 * - バックエンドは「土管」として動作し、data の中身を解釈しない。
 * - 各インスタンスは独立したエンティティ空間を持つ。
 */

// instanceId → entityId → ComponentInstance のネストした Map
const instanceStates: Map<string, Map<string, ComponentInstance>> = new Map();

function getInstanceEntityMap(instanceId: string): Map<string, ComponentInstance> {
    let state = instanceStates.get(instanceId);
    if (!state) {
        state = new Map();
        instanceStates.set(instanceId, state);
        logger.debug(`インスタンス ${instanceId} のエンティティ状態を初期化しました`);
    }
    return state;
}

/**
 * 指定インスタンスの全エンティティを配列で取得。
 */
export function getInstanceSnapshot(instanceId: string): ComponentInstance[] {
    return Array.from(getInstanceEntityMap(instanceId).values());
}

interface CreateEntityInput extends Omit<ComponentInstance, 'id'> {
    /** 安定 ID。省略時はランダム UUID を採番する。 */
    id?: string;
}

/**
 * 新しいエンティティを作成。
 */
export function createEntity(instanceId: string, input: CreateEntityInput): ComponentInstance {
    const state = getInstanceEntityMap(instanceId);
    const { id, ...rest } = input;
    const entity: ComponentInstance = { ...rest, id: id ?? randomUUID() };
    state.set(entity.id, entity);
    logger.debug(`エンティティ作成: ${entity.id} (type: ${entity.type}, instance: ${instanceId})`);
    return entity;
}

/**
 * エンティティを部分更新（transform / data は深くマージ）。
 */
export function patchEntity(
    instanceId: string,
    entityId: string,
    patch: Partial<Omit<ComponentInstance, 'id' | 'type'>>,
): ComponentInstance | null {
    const state = getInstanceEntityMap(instanceId);
    const entity = state.get(entityId);
    if (!entity) {
        logger.debug(`パッチ対象のエンティティが見つかりません: ${entityId}`);
        return null;
    }
    const updated: ComponentInstance = {
        ...entity,
        ...patch,
        transform: patch.transform ? { ...entity.transform, ...patch.transform } : entity.transform,
        data: patch.data
            ? { ...(entity.data as Record<string, unknown>), ...(patch.data as Record<string, unknown>) }
            : entity.data,
    };
    state.set(entityId, updated);
    logger.debug(`エンティティ更新: ${entityId}`);
    return updated;
}

/**
 * エンティティを削除。
 */
export function deleteEntity(instanceId: string, entityId: string): boolean {
    const state = getInstanceEntityMap(instanceId);
    const deleted = state.delete(entityId);
    logger.debug(deleted ? `エンティティ削除: ${entityId}` : `削除対象のエンティティが見つかりません: ${entityId}`);
    return deleted;
}

/**
 * エンティティを取得。
 */
export function getEntity(instanceId: string, entityId: string): ComponentInstance | undefined {
    return getInstanceEntityMap(instanceId).get(entityId);
}

/**
 * インスタンスのエンティティ状態をクリア（インスタンス終了時）。
 */
export function clearInstanceState(instanceId: string): void {
    instanceStates.delete(instanceId);
    logger.debug(`インスタンス ${instanceId} のエンティティ状態をクリアしました`);
}
