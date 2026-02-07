import { DEFAULT_PENS, PEN_CONFIG } from '@ubichill/plugin-pen';
import { useSocket, useWorld } from '@ubichill/sdk';
import { useEffect, useRef } from 'react';

/**
 * ルームの初期化状態を監視し、必要なエンティティがなければ作成するフック。
 * Feature Registryパターンへの移行の第一歩として、まずはハードコードで実装。
 */
export const useRoomInitializer = (roomId: string | null) => {
    const { entities, createEntity, isConnected, activePlugins } = useWorld();
    const { currentUser } = useSocket();
    const initializedRef = useRef(false);

    useEffect(() => {
        // 条件: ルームに参加済み、接続済み、ユーザー情報あり、初期化未完了
        // さらに、activePlugins がロードされていることを確認 (少なくとも1つはあるはず、または空配列が確定している状態)
        // ここでは pen:pen に依存しているので、activePlugins に pen:pen があるか確認する
        if (!roomId || !isConnected || !currentUser || initializedRef.current) return;

        // ペンプラグインが有効でない場合は初期化しない
        if (!activePlugins.includes('pen:pen')) {
            return;
        }

        // 既存のペンがあるか確認
        const existingPens = Array.from(entities.values()).filter((e) => e.type === 'pen:pen');

        if (existingPens.length === 0) {
            console.log('[useRoomInitializer] No pens found. Initializing default pens.');

            DEFAULT_PENS.forEach((def) => {
                createEntity(
                    'pen:pen',
                    {
                        x: PEN_CONFIG.TRAY_X_BASE + def.x,
                        y: PEN_CONFIG.DEFAULT_Y,
                        z: 0,
                        w: 48,
                        h: 48,
                        scale: 1,
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
    }, [roomId, isConnected, currentUser, entities, createEntity, activePlugins]);
};
