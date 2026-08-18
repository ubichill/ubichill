/**
 * UEP (Ubichill Entity Protocol) のエンティティ操作ハンドラ。
 *  - entity:create     : 新規 entity をルーム参加者へ broadcast
 *  - entity:patch      : 永続化 + broadcast (Reliable)
 *  - entity:ephemeral  : 永続化せず broadcast のみ (Volatile)
 *  - entity:delete     : 削除 + broadcast
 *
 * ゼロトラスト境界: watchScope/entityRef の可視範囲チェックは Host (クライアント) 側
 * (`useModWorld.ts`) にしかなく、Socket.IO イベントを直接送れば回避できてしまう。
 * ここでは「同一 socket.io ルーム」以上の認可を持たない攻撃者から状態を守るための
 * 最低限の検証を行う: ownerId のなりすまし防止・lock 中のエンティティの保護・所有者
 * 以外による削除の禁止。
 */
import type { ComponentInstance, EntityEphemeralPayload, EntityPatchPayload } from '@ubichill/shared';
import { createEntity, deleteEntity, getEntity, patchEntity } from '../services/instanceState';
import { logger } from '../utils/logger';
import { stableUserId, type TypedSocket } from './_shared';

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
            // ownerId はクライアントを信用せず、認証済み socket から必ずサーバーが設定する。
            const entity = createEntity(instanceId, { ...payload, ownerId: stableUserId(socket) ?? null });
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
        const userId = stableUserId(socket);
        if (!userId) {
            socket.emit('error', '認証されていません');
            return;
        }

        const { entityId, patch } = payload;
        const current = getEntity(instanceId, entityId);
        if (!current) {
            socket.emit('error', 'エンティティが見つかりません');
            return;
        }

        // 他ユーザーが lock 中のエンティティは、その本人以外は書き換えられない。
        if (current.lockedBy && current.lockedBy !== userId) {
            socket.emit('error', '他のユーザーが操作中のエンティティは更新できません');
            return;
        }

        // ownerId はここでは不変（作成時にのみ決まる）。クライアントが送っても無視する。
        const { ownerId: _ignoredOwnerId, lockedBy: patchLockedBy, ...safePatch } = patch;
        const sanitizedPatch: EntityPatchPayload['patch'] = { ...safePatch };
        // lockedBy は「自分として取得」「解放」のみ許可。他人になりすましてロックはできない。
        if (patchLockedBy !== undefined) {
            sanitizedPatch.lockedBy = patchLockedBy === null ? null : userId;
        }

        const updated = patchEntity(instanceId, entityId, sanitizedPatch);
        if (!updated) {
            socket.emit('error', 'エンティティが見つかりません');
            return;
        }

        socket.to(instanceId).emit('entity:patched', { entityId, patch: sanitizedPatch });
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
        const userId = stableUserId(socket);
        if (!userId) {
            socket.emit('error', '認証されていません');
            return;
        }

        const current = getEntity(instanceId, entityId);
        if (!current) {
            socket.emit('error', 'エンティティが見つかりません');
            return;
        }
        if (current.lockedBy && current.lockedBy !== userId) {
            socket.emit('error', '他のユーザーが操作中のエンティティは削除できません');
            return;
        }
        // ownerId が未設定 (null) のエンティティは mod が自律的に spawn/destroy する運用
        // (例: 弾・ストローク) のため許可する。所有者がいる場合は本人のみ削除できる。
        if (current.ownerId !== null && current.ownerId !== userId) {
            socket.emit('error', '他のユーザーが所有するエンティティは削除できません');
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
