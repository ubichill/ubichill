'use client';

import { useSocket, useWorld, Z_INDEX } from '@ubichill/sdk';
import { DEFAULTS } from '@ubichill/shared';
import type React from 'react';
import { EntityRenderer } from '@/core/components/EntityRenderer';
import { useRoomInitializer } from '@/core/hooks/useRoomInitializer';
import { INSTALLED_PLUGINS } from '@/plugins/registry';

export const UbichillOverlay: React.FC = () => {
    const { isConnected } = useSocket();
    const { entities, activePlugins } = useWorld();

    useRoomInitializer(DEFAULTS.ROOM_ID);

    if (!isConnected) {
        return null;
    }

    // エンティティのレンダリング
    const renderEntities = Array.from(entities.values()).map((entity) => {
        return <EntityRenderer key={entity.id} entityId={entity.id} />;
    });

    // プラグインの SingletonComponent を自動的にレンダリング (アクティブなプラグインのみ)
    const renderPluginSingletons = INSTALLED_PLUGINS.filter(
        (plugin) => activePlugins.includes(plugin.id) && plugin.SingletonComponent,
    ).map((plugin) => {
        const Component = plugin.SingletonComponent;
        return Component ? <Component key={plugin.id} /> : null;
    });

    return (
        <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: Z_INDEX.UI_BASE }}>
            {/* ウィジェットレイヤー（動的レンダリング） */}
            {renderEntities}

            {/* プラグインのシングルトンコンポーネント（トレイなど） */}
            {renderPluginSingletons}
        </div>
    );
};
