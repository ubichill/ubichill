import type { WorkerModDefinition } from '@ubichill/react';
import { HoldProvider, isWorkerMod, useSocket, useWorld, WorkerModHost } from '@ubichill/react';
import type { ComponentInstance } from '@ubichill/shared';
import { useMemo } from 'react';
import { useModRegistry } from '@/mods/ModRegistryContext';
import { Z_INDEX } from '@/styles/layers';
import { EntityRenderer } from './EntityRenderer';

const FALLBACK_ENTITY: ComponentInstance = {
    id: '',
    type: '',
    ownerId: null,
    lockedBy: null,
    data: {},
    transform: { x: 0, y: 0, z: 0, w: 0, h: 0, scale: 1, rotation: 0 },
};

export const InstanceRenderer: React.FC = () => {
    const { isConnected } = useSocket();
    const { entities, environment, activeMods } = useWorld();
    const { modMap } = useModRegistry();

    // フックは早期 return より前にすべて宣言する（Rules of Hooks）
    const singletonWorkerMods = useMemo(
        () =>
            Array.from(modMap.values()).filter((p) => {
                if (!isWorkerMod(p) || !p.singleton) return false;
                const modId = p.id.split(':')[0];
                return modId ? activeMods.includes(modId) : false;
            }),
        [modMap, activeMods],
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
        <HoldProvider>
            <div
                data-scroll-world
                style={{
                    position: 'fixed',
                    inset: 0,
                    overflow: 'auto',
                    backgroundColor: environment.backgroundColor,
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
                    {singletonWorkerMods.map((mod) => {
                        const def = mod as WorkerModDefinition;
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
                                <WorkerModHost entityId={`singleton:${def.id}`} entity={entity} definition={def} />
                            </div>
                        );
                    })}
                </div>
            </div>
        </HoldProvider>
    );
};
