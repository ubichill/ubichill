'use client';

import { DEFAULTS } from '@ubichill/shared';
import type React from 'react';
import { EntityRenderer } from '@/core/components/EntityRenderer';
import { useWorld } from '@/core/contexts/WorldContext';
import { useRoomInitializer } from '@/core/hooks/useRoomInitializer';
import { useSocket } from '@/core/hooks/useSocket';
import { PenTray } from '@/plugins/pen/PenTray';
import { Z_INDEX } from '@/styles/layers';

export const UbichillOverlay: React.FC = () => {
    const { isConnected } = useSocket();
    const { entities } = useWorld();

    useRoomInitializer(DEFAULTS.ROOM_ID);

    if (!isConnected) {
        return null;
    }

    // エンティティのレンダリング
    const renderEntities = Array.from(entities.values()).map((entity) => {
        return <EntityRenderer key={entity.id} entityId={entity.id} />;
    });

    return (
        <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: Z_INDEX.UI_BASE }}>
            {/* ウィジェットレイヤー（動的レンダリング） */}
            {renderEntities}

            {/* 機能オーバーレイ（トレイなど） */}
            <PenTray />
        </div>
    );
};
