import { isWorkerPlugin, useWorld, WorkerPluginHost } from '@ubichill/react';
import type React from 'react';
import { usePluginRegistry } from '../plugins/PluginRegistryContext';

interface EntityRendererProps {
    entityId: string;
}

/**
 * Worker プラグイン エンティティ用ホスト。useSocket を購読しないことで
 * カーソル移動などの再レンダーを避ける。
 */
export const EntityRenderer: React.FC<EntityRendererProps> = ({ entityId }) => {
    const { entities } = useWorld();
    const { pluginMap, loadPlugin } = usePluginRegistry();

    const entity = entities.get(entityId);
    if (!entity) return null;

    const plugin = pluginMap.get(entity.type);
    if (!plugin) {
        loadPlugin(entity.type);
        return null;
    }
    if (!isWorkerPlugin(plugin)) return null;
    // singleton は InstanceRenderer 側で起動するためここではスキップ
    if (plugin.singleton) return null;

    const isCanvas = (plugin.canvasTargets?.length ?? 0) > 0;
    const { x, y, z, w, h, scale, rotation } = entity.transform;
    // transform に w/h があれば overflow:hidden でプラグイン UI を強制 clip する。
    // 0 (= サイズ未指定) のときはプラグインの自然サイズを尊重。
    const sized = w > 0 && h > 0;
    const wrapperStyle: React.CSSProperties = isCanvas
        ? { position: 'absolute', inset: 0, zIndex: z || undefined, pointerEvents: 'none' }
        : {
              position: 'absolute',
              left: x,
              top: y,
              zIndex: z || undefined,
              width: w > 0 ? w : undefined,
              height: h > 0 ? h : undefined,
              overflow: sized ? 'hidden' : undefined,
              pointerEvents: 'none',
              transform: `scale(${scale ?? 1}) rotate(${rotation ?? 0}deg)`,
              transformOrigin: '0 0',
          };

    return (
        <div style={wrapperStyle}>
            <WorkerPluginHost entityId={entityId} entity={entity} definition={plugin} />
        </div>
    );
};
