'use client';

import { useSocket, useWorld } from '@ubichill/sdk';
import type React from 'react';
import { PLUGIN_MAP } from '../../plugins/registry';

interface EntityRendererProps {
    entityId: string;
}

export const EntityRenderer: React.FC<EntityRendererProps> = ({ entityId }) => {
    const { entities, patchEntity, ephemeralData } = useWorld();
    const { socket } = useSocket();

    const entity = entities.get(entityId);
    if (!entity) return null;

    const plugin = PLUGIN_MAP.get(entity.type);
    if (!plugin) return null;

    const { Component } = plugin;

    const handleUpdate = (patch: Partial<import('@ubichill/shared').WorldEntity<unknown>>) => {
        patchEntity(entityId, patch);
    };

    const handleBroadcast = (data: unknown) => {
        if (socket) {
            socket.emit('entity:ephemeral', { entityId, data });
        }
    };

    const ephemeral = ephemeralData.get(entityId);

    // Note: The user requested Core to provide a 'frame' for positioning.
    // We position the container absolute. Plugins that need standard behavior will fit inside.
    // Plugins like Pen that use fixed positioning for local interaction will break out of flow, which is fine.

    return (
        <div
            style={{
                position: 'absolute',
                left: 0,
                top: 0,
            }}
        >
            <Component
                entity={entity}
                isLocked={!!entity.lockedBy}
                update={handleUpdate}
                ephemeral={ephemeral}
                broadcast={handleBroadcast}
            />
        </div>
    );
};
