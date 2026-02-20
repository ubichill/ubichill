'use client';

import { useSocket, useWorld, Z_INDEX } from '@ubichill/sdk';
import { DEFAULTS } from '@ubichill/shared';
import type React from 'react';
import { EntityRenderer } from '@/core/components/EntityRenderer';
import { useWorldInitializer } from '@/core/hooks/useWorldInitializer';

export const UbichillOverlay: React.FC = () => {
    const { isConnected } = useSocket();
    const { entities } = useWorld();

    useWorldInitializer(DEFAULTS.WORLD_ID);

    if (!isConnected) {
        return null;
    }

    // エンティティのレンダリング
    const renderEntities = Array.from(entities.values()).map((entity) => {
        return <EntityRenderer key={entity.id} entityId={entity.id} />;
    });

    // Singleton components are now handled by APP_PLUGINS in page.tsx

    return (
        <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: Z_INDEX.UI_BASE }}>
            {/* ウィジェットレイヤー（動的レンダリング） */}
            {renderEntities}
        </div>
    );
};
