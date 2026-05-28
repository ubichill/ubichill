import type { WorkerPluginDefinition } from '@ubichill/sdk/react';
import { isWorkerPlugin, useSocket, useWorld, WorkerPluginHost } from '@ubichill/sdk/react';
import type { ComponentInstance } from '@ubichill/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePluginRegistry } from '@/plugins/PluginRegistryContext';
import { Z_INDEX } from '@/styles/layers';
import { EntityRenderer } from './EntityRenderer';

export interface WorkerLoadState {
    required: number;
    ready: number;
    snapshotRevision: number;
}

interface InstanceRendererProps {
    onWorkerLoadStateChange?: (state: WorkerLoadState) => void;
}

export const InstanceRenderer: React.FC<InstanceRendererProps> = ({ onWorkerLoadStateChange }) => {
    const { isConnected } = useSocket();
    const { entities, environment, snapshotRevision } = useWorld();
    const { pluginMap } = usePluginRegistry();
    const [readyWorkerIds, setReadyWorkerIds] = useState<Set<string>>(new Set());

    // フックは早期 return より前にすべて宣言する（Rules of Hooks）
    const singletonEntries = useMemo(() => {
        const entries: Array<{ definition: WorkerPluginDefinition; entity: ComponentInstance }> = [];
        const seen = new Set<string>();
        for (const entity of entities.values()) {
            const plugin = pluginMap.get(entity.type);
            if (!plugin || !isWorkerPlugin(plugin) || !plugin.singleton || seen.has(plugin.id)) continue;
            entries.push({ definition: plugin as WorkerPluginDefinition, entity });
            seen.add(plugin.id);
        }
        return entries;
    }, [entities, pluginMap]);

    const expectedWorkerIds = useMemo(() => {
        const ids = new Set<string>();
        let unresolvedPluginCount = 0;

        for (const entity of entities.values()) {
            const plugin = pluginMap.get(entity.type);
            if (!plugin) {
                unresolvedPluginCount += 1;
                continue;
            }
            if (!isWorkerPlugin(plugin)) continue;
            if (plugin.singleton) {
                ids.add(`singleton:${plugin.id}`);
            } else {
                ids.add(entity.id);
            }
        }

        return { ids, unresolvedPluginCount };
    }, [entities, pluginMap]);

    const handleWorkerReady = useCallback((workerId: string) => {
        setReadyWorkerIds((prev) => {
            if (prev.has(workerId)) return prev;
            const next = new Set(prev);
            next.add(workerId);
            return next;
        });
    }, []);

    useEffect(() => {
        setReadyWorkerIds(() => {
            snapshotRevision;
            return new Set();
        });
    }, [snapshotRevision]);

    useEffect(() => {
        setReadyWorkerIds((prev) => {
            let changed = false;
            const next = new Set<string>();
            for (const id of prev) {
                if (expectedWorkerIds.ids.has(id)) {
                    next.add(id);
                } else {
                    changed = true;
                }
            }
            return changed ? next : prev;
        });
    }, [expectedWorkerIds]);

    const readyCount = useMemo(() => {
        let count = 0;
        for (const id of expectedWorkerIds.ids) {
            if (readyWorkerIds.has(id)) count += 1;
        }
        return count;
    }, [expectedWorkerIds, readyWorkerIds]);

    useEffect(() => {
        onWorkerLoadStateChange?.({
            required: expectedWorkerIds.ids.size + expectedWorkerIds.unresolvedPluginCount,
            ready: readyCount,
            snapshotRevision,
        });
    }, [expectedWorkerIds, readyCount, snapshotRevision, onWorkerLoadStateChange]);

    const renderEntities = useMemo(
        () =>
            Array.from(entities.keys()).map((id) => (
                <EntityRenderer key={id} entityId={id} onWorkerReady={handleWorkerReady} />
            )),
        [entities, handleWorkerReady],
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
                {singletonEntries.map(({ definition: def, entity }) => {
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
                            <WorkerPluginHost
                                entityId={`singleton:${def.id}`}
                                entity={entity}
                                definition={def}
                                onReady={handleWorkerReady}
                            />
                        </div>
                    );
                })}
            </div>
        </div>
    );
};
