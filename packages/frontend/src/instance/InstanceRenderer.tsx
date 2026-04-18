import type { WorkerPluginDefinition } from '@ubichill/sdk/react';
import { isWorkerPlugin, useSocket, useWorld, WorkerPluginHost } from '@ubichill/sdk/react';
import type { WorldEntity } from '@ubichill/shared';
import { useMemo } from 'react';
import { usePluginRegistry } from '@/plugins/PluginRegistryContext';
import { Z_INDEX } from '@/styles/layers';
import { EntityRenderer } from './EntityRenderer';

const FALLBACK_ENTITY: WorldEntity = {
    id: '',
    type: '',
    ownerId: null,
    lockedBy: null,
    data: {},
    transform: { x: 0, y: 0, z: 0, w: 0, h: 0, scale: 1, rotation: 0 },
};

export const InstanceRenderer: React.FC = () => {
    const { isConnected } = useSocket();
    const { entities, environment } = useWorld();
    const { pluginMap } = usePluginRegistry();

    // フックは早期 return より前にすべて宣言する（Rules of Hooks）
    const singletonWorkerPlugins = useMemo(
        () => Array.from(pluginMap.values()).filter((p) => isWorkerPlugin(p) && p.singleton),
        [pluginMap],
    );

    const renderEntities = useMemo(
        () => Array.from(entities.keys()).map((id) => <EntityRenderer key={id} entityId={id} />),
        [entities],
    );

    const { width: worldWidth, height: worldHeight } = environment.worldSize;

    if (!isConnected) {
        return null;
    }

    return (
        <div
            data-scroll-world
            style={{
                position: 'fixed',
                inset: 0,
                overflow: 'auto',
                backgroundColor: environment.backgroundColor,
                backgroundImage: environment.backgroundImage ? `url(${environment.backgroundImage})` : undefined,
                backgroundSize: 'cover',
                backgroundPosition: 'center center',
                backgroundAttachment: 'fixed',
                zIndex: Z_INDEX.INSTANCE_FRAME,
            }}
        >
            <div
                style={{
                    position: 'relative',
                    width: worldWidth,
                    height: worldHeight,
                    minWidth: '100%',
                    minHeight: '100%',
                }}
            >
                {renderEntities}
                {singletonWorkerPlugins.map((plugin) => {
                    const def = plugin as WorkerPluginDefinition;
                    const entity = Array.from(entities.values()).find((e) => e.type === def.id) ?? FALLBACK_ENTITY;
                    const { x, y, z, w, h } = entity.transform;
                    return (
                        <div
                            key={def.id}
                            style={{
                                position: 'absolute',
                                left: x,
                                top: y,
                                zIndex: z || undefined,
                                width: w > 0 ? w : undefined,
                                height: h > 0 ? h : undefined,
                                pointerEvents: 'none',
                            }}
                        >
                            <WorkerPluginHost entityId={`singleton:${def.id}`} entity={entity} definition={def} />
                        </div>
                    );
                })}
            </div>
        </div>
    );
};
