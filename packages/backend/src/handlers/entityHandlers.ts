/**
 * UEP (Ubichill Entity Protocol) のエンティティ操作ハンドラ。
 *  - entity:create     : 新規 entity をルーム参加者へ broadcast
 *  - entity:patch      : 永続化 + broadcast (Reliable)
 *  - entity:ephemeral  : 永続化せず broadcast のみ (Volatile)
 *  - entity:delete     : 削除 + broadcast
 */
import type { ComponentInstance, EntityEphemeralPayload, EntityPatchPayload } from '@ubichill/shared';
import { createEntity, deleteEntity, patchEntity } from '../services/instanceState';
import { logger } from '../utils/logger';
import type { TypedSocket } from './_shared';

export function handleEntityCreate(socket: TypedSocket) {
    return (
        payload: Omit<ComponentInstance, 'id'>,
        callback: (response: { success: boolean; entity?: ComponentInstance; error?: string }) => void,
    ) => {
        const instanceId = socket.data.instanceId;
        if (!instanceId) {
            callback({ success: false, error: '最初にワールドに参加する必要があります' });
            return;
        }

        try {
            const entity = createEntity(instanceId, payload);
            callback({ success: true, entity });
            socket.to(instanceId).emit('entity:created', entity);
            logger.debug(`エンティティ作成: ${entity.id} (type: ${entity.type})`);
        } catch (error) {
            logger.error('エンティティ作成エラー:', error);
            callback({ success: false, error: 'エンティティの作成に失敗しました' });
        }
    };
}

export function handleEntityPatch(socket: TypedSocket) {
    return (payload: EntityPatchPayload) => {
        const instanceId = socket.data.instanceId;
        if (!instanceId) {
            socket.emit('error', '最初にワールドに参加する必要があります');
            return;
        }

        const { entityId, patch } = payload;
        const updated = patchEntity(instanceId, entityId, patch);
        if (!updated) {
            socket.emit('error', 'エンティティが見つかりません');
            return;
        }

        socket.to(instanceId).emit('entity:patched', payload);
        logger.debug(`エンティティパッチ: ${entityId}`);
    };
}

export function handleEntityEphemeral(socket: TypedSocket) {
    return (payload: EntityEphemeralPayload) => {
        const instanceId = socket.data.instanceId;
        if (!instanceId) {
            socket.emit('error', '最初にワールドに参加する必要があります');
            return;
        }
        socket.to(instanceId).emit('entity:ephemeral', payload);
    };
}

export function handleEntityDelete(socket: TypedSocket) {
    return (entityId: string) => {
        const instanceId = socket.data.instanceId;
        if (!instanceId) {
            socket.emit('error', '最初にワールドに参加する必要があります');
            return;
        }

        const deleted = deleteEntity(instanceId, entityId);
        if (!deleted) {
            socket.emit('error', 'エンティティが見つかりません');
            return;
        }

        socket.to(instanceId).emit('entity:deleted', entityId);
        logger.debug(`エンティティ削除: ${entityId}`);
    };
}
