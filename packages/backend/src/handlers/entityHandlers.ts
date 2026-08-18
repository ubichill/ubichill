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
import {
    type ComponentInstance,
    ComponentTypeSchema,
    EMPTY_ENTITY_TYPE,
    type EntityEphemeralPayload,
    type EntityPatchPayload,
    isCoreComponentNamespace,
} from '@ubichill/shared';
import { createEntity, deleteEntity, getEntity, patchEntity } from '../services/instanceState';
import { logger } from '../utils/logger';
import { stableUserId, type TypedSocket } from './_shared';

const MAX_ENTITY_PAYLOAD_BYTES = 64 * 1024;
const MAX_EPHEMERAL_PAYLOAD_BYTES = 32 * 1024;
const MAX_ENTITY_REF_LENGTH = 200;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isWithinJsonLimit(value: unknown, maxBytes: number): boolean {
    try {
        return Buffer.byteLength(JSON.stringify(value), 'utf8') <= maxBytes;
    } catch {
        return false;
    }
}

function isEntityRef(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0 && value.length <= MAX_ENTITY_REF_LENGTH;
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function sanitizeTransform(
    value: unknown,
    partial: boolean,
): ComponentInstance['transform'] | Partial<ComponentInstance['transform']> | null {
    if (!isRecord(value)) return null;
    const allowed = ['x', 'y', 'z', 'w', 'h', 'scale', 'rotation'] as const;
    if (Object.keys(value).some((key) => !allowed.includes(key as (typeof allowed)[number]))) return null;
    if (!partial && allowed.some((key) => !Object.hasOwn(value, key))) return null;

    const result: Partial<ComponentInstance['transform']> = {};
    for (const key of allowed) {
        if (!Object.hasOwn(value, key)) continue;
        const field = value[key];
        if (!isFiniteNumber(field)) return null;
        if ((key === 'w' || key === 'h') && (field < 0 || field > 1_000_000)) return null;
        if (key === 'scale' && (field <= 0 || field > 1_000)) return null;
        if ((key === 'x' || key === 'y' || key === 'z') && Math.abs(field) > 10_000_000) return null;
        result[key] = field;
    }
    return result;
}

function reject(socket: TypedSocket, message: string): void {
    socket.emit('error', message);
}

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
        // core:* はワールド定義が生成する信頼済み・data-only Component。
        // 任意WorkerやSocketクライアントに動的生成させると、将来Hostが解釈する
        // Collider等の基盤状態を注入されるため、runtime create経路では閉じる。
        const raw = payload as unknown;
        if (!isRecord(raw) || !isWithinJsonLimit(raw, MAX_ENTITY_PAYLOAD_BYTES)) {
            callback({ success: false, error: '不正または大きすぎるエンティティです' });
            return;
        }
        // createEntity() は内部初期化用に安定 id を受け取れるが、Socket 境界では絶対に
        // 通さない。既存 Map entry の上書き（Component takeover）を防ぐ。
        if (Object.hasOwn(raw, 'id')) {
            callback({ success: false, error: 'クライアントは id を指定できません' });
            return;
        }
        if (
            typeof raw.type !== 'string' ||
            !ComponentTypeSchema.safeParse(raw.type).success ||
            raw.type === EMPTY_ENTITY_TYPE ||
            isCoreComponentNamespace(raw.type)
        ) {
            callback({ success: false, error: 'core Component はワールド定義でのみ配置できます' });
            return;
        }
        const transform = sanitizeTransform(raw.transform, false);
        if (!transform || !isRecord(raw.data)) {
            callback({ success: false, error: 'エンティティの形式が不正です' });
            return;
        }
        if (raw.entityId !== undefined && !isEntityRef(raw.entityId)) {
            callback({ success: false, error: 'entityId が不正です' });
            return;
        }
        if (raw.parentEntityId !== undefined && !isEntityRef(raw.parentEntityId)) {
            callback({ success: false, error: 'parentEntityId が不正です' });
            return;
        }

        try {
            // ownerId はクライアントを信用せず、認証済み socket から必ずサーバーが設定する。
            // lockedBy も入力を捨てる。作成と同時に他人名義でロックする junk/DoS を防ぐ。
            const entity = createEntity(instanceId, {
                type: raw.type,
                ...(raw.entityId === undefined ? {} : { entityId: raw.entityId }),
                ...(raw.parentEntityId === undefined ? {} : { parentEntityId: raw.parentEntityId }),
                ownerId: stableUserId(socket) ?? null,
                lockedBy: null,
                transform: transform as ComponentInstance['transform'],
                data: raw.data,
            });
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

        const rawPayload = payload as unknown;
        if (!isRecord(rawPayload) || !isEntityRef(rawPayload.entityId) || !isRecord(rawPayload.patch)) {
            reject(socket, 'エンティティパッチの形式が不正です');
            return;
        }
        if (!isWithinJsonLimit(rawPayload, MAX_ENTITY_PAYLOAD_BYTES)) {
            reject(socket, 'エンティティパッチが大きすぎます');
            return;
        }
        const { entityId } = rawPayload;
        const patch = rawPayload.patch;
        // TS の Omit は実行時には消える。immutable field を明示的に拒否し、Map key と
        // entity.id/type の不整合や core:* への型変更を防ぐ。
        if (
            Object.hasOwn(patch, 'id') ||
            Object.hasOwn(patch, 'type') ||
            Object.hasOwn(patch, 'entityId') ||
            Object.hasOwn(patch, 'parentEntityId')
        ) {
            reject(socket, 'id、type、Entity hierarchy は変更できません');
            return;
        }
        const current = getEntity(instanceId, entityId);
        if (!current) {
            socket.emit('error', 'エンティティが見つかりません');
            return;
        }
        if (isCoreComponentNamespace(current.type)) {
            socket.emit('error', 'core Component はruntimeでは更新できません');
            return;
        }

        // 他ユーザーが lock 中のエンティティは、その本人以外は書き換えられない。
        if (current.lockedBy && current.lockedBy !== userId) {
            socket.emit('error', '他のユーザーが操作中のエンティティは更新できません');
            return;
        }

        // ownerId はここでは不変（作成時にのみ決まる）。クライアントが送っても無視する。
        const sanitizedPatch: EntityPatchPayload['patch'] = {};
        if (patch.transform !== undefined) {
            const transform = sanitizeTransform(patch.transform, true);
            if (!transform) return reject(socket, 'transform が不正です');
            sanitizedPatch.transform = transform as ComponentInstance['transform'];
        }
        if (patch.data !== undefined) {
            if (!isRecord(patch.data)) return reject(socket, 'data が不正です');
            sanitizedPatch.data = patch.data;
        }
        const patchLockedBy = patch.lockedBy;
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
        const raw = payload as unknown;
        if (!stableUserId(socket)) return reject(socket, '認証されていません');
        if (!isRecord(raw) || !isEntityRef(raw.entityId) || !isWithinJsonLimit(raw, MAX_EPHEMERAL_PAYLOAD_BYTES)) {
            return reject(socket, 'エフェメラルデータが不正または大きすぎます');
        }
        if (!getEntity(instanceId, raw.entityId)) return reject(socket, 'エンティティが見つかりません');
        socket.to(instanceId).emit('entity:ephemeral', { entityId: raw.entityId, data: raw.data });
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
        if (isCoreComponentNamespace(current.type)) {
            socket.emit('error', 'core Component はruntimeでは削除できません');
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
