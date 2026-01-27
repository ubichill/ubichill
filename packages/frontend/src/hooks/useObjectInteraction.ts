import { useCallback, useEffect, useRef } from 'react';
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
}

export const useObjectInteraction = (
    entityId: string,
    entityType: string,
    isLockedByMe: boolean,
    options: InteractionOptions = {}
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
            (e) => e.lockedBy === (currentUser as any)?.id // currentUserの型依存
                && e.id !== entityId
            // && e.type === entityType // 同じタイプだけにする？それとも全タイプ？「手は2つない」なら全タイプ
        );

        myHeldEntities.forEach((ent) => {
            console.log(`[useObjectInteraction] Releasing other entity: ${ent.id}`);

            // トレイに戻すロジック（Pen固有）を汎用化するのは難しいが
            // ここでは「その場に離す」または「初期位置に戻す」
            // PenWidgetで実装されていた「色ごとの位置」はここにハードコードしたくない...
            // 一旦「Heldフラグを下ろしてロック解除」だけ行い、位置は維持（またはPenWidget側でResetリスナーを持つ？）

            // Penの場合は UbichillOverlay のロジックと重複するが、
            // 「手放す」ときはトレイに戻したいというのがPenの仕様。
            // 汎用フックとしては「ロック解除」までしか責任を持てないかもしれない。
            // しかしユーザーは「簡単設定」を求めている。

            // 特例: Penの場合はトレイ座標を計算してパッチする
            let targetX = ent.transform.x;
            let targetY = ent.transform.y;

            if (ent.type === 'pen') {
                const pData = ent.data as any;
                let offsetX = 0;
                if (pData.color === '#FF0000') offsetX = -50;
                else if (pData.color === '#0000FF') offsetX = 50;
                else if (pData.color === '#00FF00') offsetX = 150;
                else offsetX = -150; // 黒
                targetX = 600 + offsetX;
                targetY = 40;
            }

            patchEntity(ent.id, {
                lockedBy: null,
                transform: {
                    ...ent.transform,
                    x: targetX,
                    y: targetY,
                    rotation: 0
                },
                data: {
                    ...ent.data,
                    isHeld: false
                } as any
            });
        });

    }, [entities, currentUser, options.singleHold, patchEntity, entityId, entityType]);

    return {
        releaseOthers
    };
};
