import type { WorkerPluginDefinition } from '@ubichill/sdk/react';
import { GenericPluginHost, isWorkerPlugin, useSocket, useWorld } from '@ubichill/sdk/react';
import type { UbiInstanceContext } from '@ubichill/sdk/ui';
import type { WorldEntity } from '@ubichill/shared';
import React, { useLayoutEffect, useMemo, useRef } from 'react';
import { usePluginRegistry } from '@/plugins/PluginRegistryContext';
import { Z_INDEX } from '@/styles/layers';
import { EntityRenderer } from './EntityRenderer';
import { loadImage } from './imageLoader';

// ============================================
// シングルトン CE をマウントし instanceCtx を注入するコンポーネント
// ============================================

interface SingletonMountProps {
    tag: string;
    ctx: UbiInstanceContext;
}

const SingletonMount: React.FC<SingletonMountProps> = ({ tag, ctx }) => {
    const ref = useRef<HTMLElement>(null);

    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return;
        // @ts-expect-error — CE に instanceCtx を注入
        el.instanceCtx = ctx;
    });

    return React.createElement(tag, {
        ref,
        style: { display: 'contents' },
    });
};

// ============================================
// InstanceRenderer — インスタンス参加中のオーバーレイ全体
// ============================================

// ============================================
// singleton WorkerPlugin ホスト（avatar 等）
// ============================================

const FALLBACK_ENTITY: WorldEntity = {
    id: '',
    type: '',
    ownerId: null,
    lockedBy: null,
    data: {},
    transform: { x: 0, y: 0, z: 0, w: 0, h: 0, scale: 1, rotation: 0 },
};

interface SingletonWorkerHostProps {
    plugin: WorkerPluginDefinition;
    /** World YAML から解決したエンティティ（transform.z で z-index を決定） */
    entity: WorldEntity;
    updateUser: ReturnType<typeof useSocket>['updateUser'];
}

const SingletonWorkerHost: React.FC<SingletonWorkerHostProps> = ({ plugin, entity, updateUser }) => {
    const updateUserRef = useRef(updateUser);
    useLayoutEffect(() => {
        updateUserRef.current = updateUser;
    });

    const sendHostMessageRef = useRef<((type: string, payload: unknown) => void) | null>(null);

    const handleCustomMessage = React.useCallback((type: string, payload: unknown) => {
        if (type === 'avatar:applyTemplate') {
            // Worker からバージョン付き URL のリストを受け取り、各ファイルをデコードして states を構築
            const { files } = payload as { files: Array<{ state: string; url: string }> };
            void Promise.all(files.map(async ({ state, url }) => [state, await loadImage(url)] as const)).then(
                (entries) => {
                    const states = Object.fromEntries(entries.map(([state, frame]) => [state, frame]));
                    updateUserRef.current({ avatar: { states } });
                },
            );
        } else if (type === 'avatar:resetTemplate') {
            updateUserRef.current({ avatar: { states: {} } });
        } else if (type === 'avatar:initThumbnails') {
            // Worker からバージョン付き URL のリストを受け取り、サムネイルをデコードして返す
            const { thumbnailFiles } = payload as { thumbnailFiles: Array<{ id: string; url: string }> };
            void Promise.all(
                thumbnailFiles.map(async ({ id, url }) => {
                    try {
                        const frame = await loadImage(url);
                        return [id, frame.url] as const;
                    } catch {
                        return null;
                    }
                }),
            ).then((results) => {
                const thumbnails = Object.fromEntries(results.filter((r) => r !== null));
                sendHostMessageRef.current?.('avatar:thumbnails', { thumbnails });
            });
        }
    }, []);

    const isSettings = plugin.id === 'avatar:settings';
    const { x, y, z, w, h } = entity.transform;

    return (
        <div
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
            <GenericPluginHost
                entityId={`singleton:${plugin.id}`}
                entity={entity}
                definition={plugin}
                onCustomMessage={isSettings ? handleCustomMessage : undefined}
                sendHostMessageRef={isSettings ? sendHostMessageRef : undefined}
            />
        </div>
    );
};

export const InstanceRenderer: React.FC = () => {
    const { isConnected, socket, currentUser, users, updateUser, updatePosition } = useSocket();
    const { entities, patchEntity, createEntity, ephemeralData, environment } = useWorld();
    const { pluginMap } = usePluginRegistry();

    // フックは早期 return より前にすべて宣言する（Rules of Hooks）
    const singletonTags = useMemo(() => {
        const tags: string[] = [];
        for (const plugin of pluginMap.values()) {
            if ('singletonTag' in plugin && plugin.singletonTag) tags.push(plugin.singletonTag);
            if ('singletonTags' in plugin && plugin.singletonTags) tags.push(...plugin.singletonTags);
        }
        return tags;
    }, [pluginMap]);

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

    // インスタンスコンテキストを構築（UbiSingleton へ注入）
    const instanceCtx: UbiInstanceContext = {
        currentUser,
        users,
        isConnected,
        updateUser,
        updatePosition,
        entities,
        patchEntity,
        createEntity: async (type, transform, data) => {
            const result = await createEntity(type, transform, data);
            return result ?? null;
        },
        ephemeralData,
        broadcastEphemeral: (entityId, data) => {
            socket?.emit('entity:ephemeral', { entityId, data });
        },
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
                {singletonTags.map((tag) => (
                    <SingletonMount key={tag} tag={tag} ctx={instanceCtx} />
                ))}
                {singletonWorkerPlugins.map((plugin) => {
                    if (!isWorkerPlugin(plugin)) return null;
                    const singletonEntity =
                        Array.from(entities.values()).find((e) => e.type === plugin.id) ?? FALLBACK_ENTITY;
                    return (
                        <SingletonWorkerHost
                            key={plugin.id}
                            plugin={plugin}
                            entity={singletonEntity}
                            updateUser={updateUser}
                        />
                    );
                })}
            </div>
        </div>
    );
};
