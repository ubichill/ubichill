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
// 変更があったインスタンスIDを保持するSet（定期保存用）
const dirtyInstances: Set<string> = new Set();

import { prisma } from '../lib/prisma';

/**
 * DBからワールド状態をロード（存在する場合）
 * メモリ上に既にある場合は何もしない
 */
export async function ensureWorldStateLoaded(instanceId: string): Promise<void> {
    if (worldStates.has(instanceId)) {
        return;
    }

    try {
        const state = await prisma.worldState.findUnique({
            where: { instanceId },
        });

        if (state?.entities) {
            const entityMap = new Map<string, WorldEntity>();
            const entities = state.entities as unknown as WorldEntity[];

            entities.forEach((e) => {
                entityMap.set(e.id, e);
            });

            worldStates.set(instanceId, entityMap);
            logger.info(`DBからワールド状態を復元しました: ${instanceId} (${entities.length} entities)`);
        }
    } catch (error) {
        logger.error(`ワールド状態のロードに失敗: ${instanceId}`, error);
    }
}

/**
 * ワールド状態をDBに保存
 */
async function saveWorldState(instanceId: string): Promise<void> {
    const instanceState = worldStates.get(instanceId);
    if (!instanceState) return;

    const entities = Array.from(instanceState.values());

    try {
        // Instanceが存在しないと外部キー制約で失敗するので、
        // Instanceがない場合は作成する（シングルトンルームの場合など）のケアが必要だが
        // 基本的にInstanceレコードは createInstance で作られるべき。
        // ただし、defaultルームなどはInstanceレコードがないまま動くことがあるため、
        // ここでupsertする際にInstanceも作るか、あるいはWorldStateだけ保存...はできない（Relationあるため）。

        // 簡易対策: instanceIdがルームIDと同じ（シングルトン）の場合、
        // Instanceテーブルに対応するレコードがあるか確認し、なければ作る

        // WorldStateの保存
        await prisma.worldState.upsert({
            where: { instanceId },
            update: {
                entities: entities as unknown as object,
                version: { increment: 1 },
            },
            create: {
                instanceId,
                entities: entities as unknown as object,
            },
        });
        logger.debug(`ワールド状態を保存しました: ${instanceId}`);
        // biome-ignore lint/suspicious/noExplicitAny: error type is unknown in strict mode but we need to check .code
    } catch (error: any) {
        // FK制約違反 (P2003) の場合、Instanceがない可能性がある
        if (error.code === 'P2003') {
            logger.warn(`Instance missing for ${instanceId}, attempting to create...`);
            try {
                // instanceId が room slug と一致するか確認
                const room = await prisma.room.findUnique({ where: { slug: instanceId } });
                if (room) {
                    // Singleton Instanceを作成
                    await prisma.instance.create({
                        data: {
                            id: instanceId,
                            roomId: room.id,
                            status: 'ACTIVE',
                        },
                    });

                    // Retry save
                    await prisma.worldState.create({
                        data: {
                            instanceId,
                            entities: entities as unknown as object,
                        },
                    });
                    logger.info(`Singleton Instance created and WorldState saved: ${instanceId}`);
                    return;
                }
            } catch (innerError) {
                logger.error(`Failed to recover Instance/WorldState for ${instanceId}`, innerError);
            }
        }
        logger.error(`ワールド状態の保存に失敗: ${instanceId}`, error);
    }
}

/**
 * 変更があったワールド状態を定期的に保存
 */
export async function flushDirtyWorldStates(): Promise<void> {
    if (dirtyInstances.size === 0) return;

    const instancesToSave = Array.from(dirtyInstances);
    dirtyInstances.clear();

    await Promise.all(instancesToSave.map((id) => saveWorldState(id)));
}

// 定期保存ループを開始（10秒ごと）
if (process.env.NODE_ENV !== 'test') {
    setInterval(() => {
        flushDirtyWorldStates().catch((err) => logger.error('Periodic save failed:', err));
    }, 10000);
}

// Dirty Marking Helper
function markDirty(instanceId: string) {
    dirtyInstances.add(instanceId);
}

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
    markDirty(instanceId);
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
    markDirty(instanceId);
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
        markDirty(instanceId);
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
