import type { WorldEntity } from '@ubichill/sdk';
import { GenericPluginHost, isWorkerPlugin, useSocket, useWorld } from '@ubichill/sdk/react';
import type { UbiEntityContext } from '@ubichill/sdk/ui';
import React, { useLayoutEffect, useRef } from 'react';
import { usePluginRegistry } from '../../plugins/PluginRegistryContext';

interface EntityRendererProps {
    entityId: string;
}

/**
 * WorkerPlugin エンティティ用。useSocket を呼ばないことで
 * カーソル移動などのソケット更新による不要な再レンダーを防ぐ。
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

    if (isWorkerPlugin(plugin)) {
        // singleton プラグインは InstanceRenderer が処理するためここではスキップ
        if (plugin.singleton) return null;

        const isCanvas = (plugin.canvasTargets?.length ?? 0) > 0;
        const { x, y, z, w, h, scale, rotation } = entity.transform;

        const wrapperStyle: React.CSSProperties = isCanvas
            ? { position: 'absolute', inset: 0, zIndex: z || undefined, pointerEvents: 'none' }
            : {
                  position: 'absolute',
                  left: x,
                  top: y,
                  zIndex: z || undefined,
                  width: w > 0 ? w : undefined,
                  height: h > 0 ? h : undefined,
                  pointerEvents: 'none',
                  transform: `scale(${scale ?? 1}) rotate(${rotation ?? 0}deg)`,
                  transformOrigin: '0 0',
              };

        return (
            <div style={wrapperStyle}>
                <GenericPluginHost entityId={entityId} entity={entity} definition={plugin} />
            </div>
        );
    }

    // Custom Element プラグイン — ソケット情報が必要なため専用コンポーネントへ委譲
    return <EntityCEHost entityId={entityId} entity={entity} elementTag={plugin.elementTag} />;
};

/** Custom Element プラグイン用ホスト。ソケット更新を購読するため EntityRenderer とは分離する。 */
const EntityCEHost: React.FC<{
    entityId: string;
    entity: WorldEntity;
    elementTag: string;
}> = ({ entityId, entity, elementTag }) => {
    const { entities, patchEntity, createEntity, ephemeralData } = useWorld();
    const { socket, currentUser, users } = useSocket();
    const ref = useRef<HTMLElement>(null);

    return (
        <EntityCEBridge
            key={elementTag}
            tag={elementTag}
            entityId={entityId}
            entity={entity}
            entities={entities}
            patchEntity={patchEntity}
            createEntity={createEntity}
            ephemeralData={ephemeralData}
            socket={socket}
            currentUser={currentUser}
            users={users}
            ref={ref}
        />
    );
};

// ============================================
// CE ブリッジ — コンテキストを注入する内部コンポーネント
// ============================================

interface BridgeProps {
    tag: string;
    entityId: string;
    entity: WorldEntity;
    entities: Map<string, WorldEntity>;
    patchEntity: (id: string, patch: Partial<WorldEntity>) => void;
    createEntity: (type: string, transform: WorldEntity['transform'], data: unknown) => Promise<WorldEntity | null>;
    ephemeralData: Map<string, unknown>;
    socket: import('socket.io-client').Socket | null;
    currentUser: import('@ubichill/shared').User | null;
    users: Map<string, import('@ubichill/shared').User>;
    ref: React.RefObject<HTMLElement | null>;
}

const EntityCEBridge: React.FC<BridgeProps> = ({
    tag,
    entityId,
    entity,
    entities,
    patchEntity,
    createEntity,
    ephemeralData,
    socket,
    currentUser,
    users,
    ref,
}) => {
    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return;

        const isLockedByMe = !!entity.lockedBy && entity.lockedBy === currentUser?.id;
        const isLockedByOther = !!entity.lockedBy && entity.lockedBy !== currentUser?.id;

        const ctx: UbiEntityContext = {
            entity,
            ephemeral: ephemeralData.get(entityId),
            patchEntity: (patch) => patchEntity(entityId, patch as Partial<WorldEntity>),
            broadcast: (data) => {
                socket?.emit('entity:ephemeral', { entityId, data });
            },
            isLocked: !!entity.lockedBy,
            isLockedByMe,
            isLockedByOther,
            lockEntity: () => {
                if (currentUser) {
                    patchEntity(entityId, { lockedBy: currentUser.id });
                }
            },
            unlockEntity: () => {
                patchEntity(entityId, { lockedBy: null });
            },
            releaseOtherLocks: (options) => {
                for (const [id, e] of entities) {
                    if (e.lockedBy !== currentUser?.id || id === entityId) continue;
                    const additionalPatch = options?.onAutoRelease?.(e) ?? {};
                    patchEntity(id, {
                        lockedBy: null,
                        ...additionalPatch,
                        data: {
                            ...(e.data as Record<string, unknown>),
                            isHeld: false,
                            ...(additionalPatch.data as Record<string, unknown>),
                        },
                    });
                }
            },
            createEntity: async (type, transform, data) => {
                const result = await createEntity(type, transform, data);
                return result ?? null;
            },
            currentUserId: currentUser?.id,
            users,
            socket: socket
                ? {
                      emit: (event, ...args) => (socket.emit as (ev: string, ...a: unknown[]) => void)(event, ...args),
                      on: (event, handler) => socket.on(event as never, handler as never),
                      off: (event, handler) => socket.off(event as never, handler as never),
                      get id() {
                          return socket.id;
                      },
                  }
                : null,
        };

        // @ts-expect-error — CE に ubiCtx を注入
        el.ubiCtx = ctx;
    });

    return React.createElement(tag, {
        ref,
        style: {
            position: 'absolute',
            left: 0,
            top: 0,
        },
    });
};
