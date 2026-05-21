/**
 * Ubi.entity — エンティティ操作の単一ネームスペース (callable)。
 *
 * 「自分」も「他」も同じ API で扱える:
 *
 * ```ts
 * // 自分自身 (引数なし)
 * await Ubi.entity().update({ lockedBy: null });
 * await Ubi.entity().destroy();
 * await Ubi.entity().spawn({ type: 'pen:stroke', data });   // 自 entity の子として spawn
 *
 * // 他の id を指定
 * await Ubi.entity(otherId).update({ lockedBy: null });
 * await Ubi.entity(otherId).destroy();
 *
 * // namespace 上のスタティックメソッド
 * const pens = await Ubi.entity.query<PenData>('pen:pen');
 * const e = await Ubi.entity.get(someId);
 * await Ubi.entity.spawn({ type: 'pen:stroke', parentEntityId: heldPenId, data });
 * ```
 */

import type { ComponentInstance, EntityPatchPayload } from '@ubichill/shared';
import type { WorldModule } from '../world';

/** 自分自身を指す参照。spawn は親を自動付与する。 */
export interface SelfEntityRef {
    update(patch: EntityPatchPayload['patch']): Promise<void>;
    destroy(): Promise<void>;
    /** 自 Entity の子として spawn する。`parentEntityId` は自動付与。 */
    spawn(child: Omit<ComponentInstance, 'id' | 'parentEntityId'>): Promise<string>;
}

/** 他 id を指す参照。parent 自動付与はないので spawn は Ubi.entity.spawn(...) を使う。 */
export interface OtherEntityRef {
    update(patch: EntityPatchPayload['patch']): Promise<void>;
    destroy(): Promise<void>;
}

export type EntityModule = {
    /** 自 Worker 自身を指す参照 (引数なし)。 */
    (): SelfEntityRef;
    /** id 指定で他の ComponentInstance を指す参照。 */
    (id: string): OtherEntityRef;
    /** type 一致の Component を取得 (watchScope に応じた可視範囲)。 */
    query<T = unknown>(type: string): Promise<ComponentInstance<T>[]>;
    /** id 指定で 1 件取得。 */
    get<T = unknown>(id: string): Promise<ComponentInstance<T> | null>;
    /** 親を明示指定して自由に spawn (`Ubi.entity().spawn` 以外のケース)。 */
    spawn(entity: Omit<ComponentInstance, 'id'>): Promise<string>;
};

export function createEntityModule(
    world: WorldModule,
    getSelfComponentInstanceId: () => string | undefined,
    getSelfEntityId: () => string | undefined,
): EntityModule {
    function makeSelf(): SelfEntityRef {
        return {
            update(patch) {
                const id = getSelfComponentInstanceId();
                if (!id) throw new Error('[Ubi.entity().update] Ubi.componentInstanceId が未設定');
                return world.update(id, patch);
            },
            destroy() {
                const id = getSelfComponentInstanceId();
                if (!id) throw new Error('[Ubi.entity().destroy] Ubi.componentInstanceId が未設定');
                return world._destroyEntity(id);
            },
            spawn(child) {
                return world._createEntity({ ...child, parentEntityId: getSelfEntityId() });
            },
        };
    }

    function makeOther(id: string): OtherEntityRef {
        return {
            update(patch) {
                return world.update(id, patch);
            },
            destroy() {
                return world._destroyEntity(id);
            },
        };
    }

    const fn = ((id?: string): SelfEntityRef | OtherEntityRef =>
        id === undefined ? makeSelf() : makeOther(id)) as EntityModule;

    fn.query = ((type: string) => world.query(type)) as EntityModule['query'];
    fn.get = ((id: string) => world.get(id)) as EntityModule['get'];
    fn.spawn = (entity) => world._createEntity(entity);

    return fn;
}
