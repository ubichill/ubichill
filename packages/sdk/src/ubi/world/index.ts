/**
 * Ubi.world — エンティティ CRUD の内部 API。
 *
 * 通常のプラグインからは `Ubi.spawn` / `Ubi.destroy` などのトップレベル shortcut や
 * `Ubi.state.persistent` の自動同期を使うことを推奨。直接 `Ubi.world.query` を
 * 呼ぶのは「自エンティティの transform.z を 1 回だけ読む」など稀なケースのみ。
 */

import { CommandType, type ComponentInstance, type EntityPatchPayload } from '@ubichill/shared';
import type { RpcFn, SendFn } from '../types';

export type WorldModule = {
    /** 指定 id (= ComponentInstance.id) のエンティティを取得。 */
    get(id: string): Promise<ComponentInstance | null>;
    /** type 一致のエンティティ一覧。watchScope に応じて可視範囲が絞られる。 */
    query(entityType: string): Promise<ComponentInstance[]>;
    /**
     * 他エンティティを直接更新するエスケープハッチ。自エンティティは `Ubi.state.*` を使う方が
     * 宣言的で安全。ペンの「他ペンの lockedBy を null にする」など、複数エンティティを横断して
     * 書く必要があるケース専用。
     */
    update(id: string, patch: EntityPatchPayload['patch']): Promise<void>;
    /** @internal Ubi.spawn から呼ばれる。 */
    _createEntity(entity: Omit<ComponentInstance, 'id'>): Promise<string>;
    /** @internal Ubi.destroy から呼ばれる。 */
    _destroyEntity(id: string): Promise<void>;
};

export function createWorldModule(send: SendFn, rpc: RpcFn): WorldModule {
    void send;
    return {
        get: (id) => rpc({ type: CommandType.SCENE_GET_ENTITY, payload: { id } }),
        query: (entityType) => rpc({ type: CommandType.SCENE_QUERY_ENTITIES, payload: { entityType } }),
        update: (id, patch) =>
            rpc({ type: CommandType.SCENE_UPDATE_ENTITY, payload: { id, patch: { entityId: id, patch } } }),
        _createEntity: (entity) => rpc({ type: CommandType.SCENE_CREATE_ENTITY, payload: { entity } }),
        _destroyEntity: (id) => rpc({ type: CommandType.SCENE_DESTROY_ENTITY, payload: { id } }),
    };
}
