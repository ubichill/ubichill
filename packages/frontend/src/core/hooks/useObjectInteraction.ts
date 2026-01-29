import type { WorldEntity } from '@ubichill/shared';
import { useCallback, useEffect } from 'react';
import { useWorld } from '../contexts/WorldContext';
import { useSocket } from './useSocket';

interface InteractionOptions {
    /**
     * trueの場合、このオブジェクトを持つとき、カーソルを非表示にする
     */
    hideCursor?: boolean;
    /**
     * trueの場合、同時に1つしか持てないようにする（他を持っていたら自動で離す）
     */
    singleHold?: boolean;
    /**
     * 自動開放時に実行されるコールバック（位置をリセットするなどで使用）
     */
    onAutoRelease?: (entity: WorldEntity) => Partial<WorldEntity>;
}

export const useObjectInteraction = (
    entityId: string,
    _entityType: string,
    isLockedByMe: boolean,
    options: InteractionOptions = {},
) => {
    const { entities, patchEntity } = useWorld();
    const { currentUser } = useSocket();

    // ==========================================
    // カーソル制御
    // ==========================================
    useEffect(() => {
        if (!options.hideCursor) return;

        if (isLockedByMe) {
            document.body.style.cursor = 'none';
        } else {
            document.body.style.cursor = 'default';
        }

        return () => {
            if (isLockedByMe) {
                document.body.style.cursor = 'default';
            }
        };
    }, [isLockedByMe, options.hideCursor]);

    // ==========================================
    // 排他制御（Single Hold）
    // ==========================================
    const releaseOthers = useCallback(() => {
        if (!options.singleHold) return;
        // UserIDが必要
        // contextから取れない場合は引数で渡すか、ここで取得する
        // ここでは一旦簡易的に実装

        // 自分がロックしている他のエンティティを探す
        const myHeldEntities = Array.from(entities.values()).filter(
            (e) => e.lockedBy === currentUser?.id && e.id !== entityId,
            // && e.type === entityType // 同じタイプだけにする？それとも全タイプ？「手は2つない」なら全タイプ
        );

        myHeldEntities.forEach((ent) => {
            console.log(`[useObjectInteraction] Releasing other entity: ${ent.id}`);

            // 位置リセットなどのカスタムロジックはコールバックに委譲
            let additionalPatch: Partial<WorldEntity> = {};
            if (options.onAutoRelease) {
                additionalPatch = options.onAutoRelease(ent);
            }

            patchEntity(ent.id, {
                lockedBy: null,
                ...additionalPatch,
                data: {
                    ...(ent.data as Record<string, unknown>),
                    isHeld: false,
                    ...(additionalPatch.data as Record<string, unknown>),
                },
            });
        });
    }, [entities, currentUser, options.singleHold, options.onAutoRelease, patchEntity, entityId]);

    return {
        releaseOthers,
    };
};
