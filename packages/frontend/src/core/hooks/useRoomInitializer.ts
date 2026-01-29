import { useEffect, useRef } from 'react';
import { DEFAULT_PENS, PEN_CONFIG } from '../../plugins/pen/config';
import { useWorld } from '../contexts/WorldContext';
import { useSocket } from '../hooks/useSocket';

/**
 * ルームの初期化状態を監視し、必要なエンティティがなければ作成するフック。
 * Feature Registryパターンへの移行の第一歩として、まずはハードコードで実装。
 */
export const useRoomInitializer = (roomId: string | null) => {
    const { entities, createEntity, isConnected } = useWorld();
    const { currentUser } = useSocket();
    const initializedRef = useRef(false);

    useEffect(() => {
        if (!roomId || !isConnected || !currentUser || initializedRef.current) return;

        // 既存のペンがあるか確認
        const existingPens = Array.from(entities.values()).filter((e) => e.type === 'pen');

        if (existingPens.length === 0) {
            console.log('[useRoomInitializer] No pens found. Initializing default pens.');

            DEFAULT_PENS.forEach((def, i) => {
                const id = `default-pen-${i}`;
                // 重複チェック (Local map check)
                if (entities.has(id)) return;

                // IDを指定して作成するためにcreateEntityのシグネチャ拡張が必要かもしれないが、
                // いったんServer側でID生成されることを受け入れるか、
                // system default penとしてIDを固定したい場合はAPI側にも手が要る。
                // 現状のsocketHandlersは `createEntity` でIDをサーバー生成している。
                // *デフォルトペン* としての意味合いを保つならID固定が望ましいが、
                // フロントエンド主導ならIDはUUIDでも良いはず。

                createEntity(
                    'pen',
                    {
                        x: PEN_CONFIG.TRAY_X_BASE + def.x,
                        y: PEN_CONFIG.DEFAULT_Y,
                        z: 0,
                        w: 48,
                        h: 48,
                        rotation: 0,
                    },
                    {
                        color: def.color,
                        strokeWidth: 4,
                        isHeld: false,
                    },
                );
            });
            initializedRef.current = true;
        } else {
            // ペンがあれば初期化済みとみなす
            initializedRef.current = true;
        }
    }, [roomId, isConnected, currentUser, entities, createEntity]);
};
