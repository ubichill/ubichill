/**
 * Ubi.entity — 自分中心の階層 CRUD。
 *
 * 「自分自身を更新 / 自分を削除 / 自分の子として spawn」を簡潔に書くための shortcut。
 * 通常は `Ubi.state.local.<key> = v` の方が宣言的で簡潔だが、複数フィールドを一括 patch
 * したいときや、明示的に「これは自分への書き込み」と示したいときに使う。
 *
 * 横断的な操作 (他エンティティを直接更新 / spawn / destroy) は `Ubi.world.*` /
 * `Ubi.spawn` / `Ubi.destroy` を使う。
 */

import type { ComponentInstance, EntityPatchPayload } from '@ubichill/shared';
import type { WorldModule } from '../world';

export interface EntityModule {
    /** 自 ComponentInstance を patch。data 内のフィールドも top-level (lockedBy/ownerId) も渡せる。 */
    update(patch: EntityPatchPayload['patch']): Promise<void>;
    /** 自 ComponentInstance を削除 (Worker は terminate される)。 */
    destroy(): Promise<void>;
    /** 自 Entity の子として新規 Entity を spawn する。parentEntityId は自動付与。 */
    spawn(child: Omit<ComponentInstance, 'id' | 'parentEntityId'>): Promise<string>;
}

export function createEntityModule(
    world: WorldModule,
    getSelfComponentInstanceId: () => string | undefined,
    getSelfEntityId: () => string | undefined,
): EntityModule {
    return {
        update(patch) {
            const id = getSelfComponentInstanceId();
            if (!id) throw new Error('[Ubi.entity.update] Ubi.componentInstanceId が未設定');
            return world.update(id, patch);
        },
        destroy() {
            const id = getSelfComponentInstanceId();
            if (!id) throw new Error('[Ubi.entity.destroy] Ubi.componentInstanceId が未設定');
            return world._destroyEntity(id);
        },
        spawn(child) {
            const parent = getSelfEntityId();
            return world._createEntity({ ...child, parentEntityId: parent });
        },
    };
}
