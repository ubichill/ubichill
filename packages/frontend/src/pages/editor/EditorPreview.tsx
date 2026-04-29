import {
    isWorkerPlugin,
    SocketContext,
    type SocketContextValue,
    WorkerPluginHost,
    WorldContext,
    type WorldContextType,
} from '@ubichill/sdk/react';
import type { WorldDefinition, WorldEntity, WorldEnvironmentData } from '@ubichill/shared';
import type React from 'react';
import { useMemo } from 'react';
import { EntityRenderer } from '@/instance/EntityRenderer';
import { PluginRegistryProvider, usePluginRegistry } from '@/plugins/PluginRegistryContext';

const FALLBACK_ENTITY: WorldEntity = {
    id: '',
    type: '',
    ownerId: null,
    lockedBy: null,
    data: {},
    transform: { x: 0, y: 0, z: 0, w: 0, h: 0, scale: 1, rotation: 0 },
};

/**
 * 編集モード用のエンティティID。
 * initialEntities 配列の index と紐付ける。
 */
export function makeEditorEntityId(index: number): string {
    return `edit-${index}`;
}

export function parseEditorEntityIndex(id: string): number | null {
    if (!id.startsWith('edit-')) return null;
    const n = Number.parseInt(id.slice('edit-'.length), 10);
    return Number.isFinite(n) ? n : null;
}

interface EditorPreviewProps {
    definition: WorldDefinition;
    /** 実プレビュー本体の追加要素（編集オーバーレイなど）。world 座標系の中に絶対配置される。 */
    overlay?: React.ReactNode;
    /** true なら親コンテナの 100% を埋める。false なら 70vh の固定高さ。 */
    fillContainer?: boolean;
    /** 編集ローカルに非表示にするエンティティの index 集合（プラグインの実体描画も止める） */
    hiddenIndices?: Set<number>;
}

/**
 * インスタンスページと同じ仕組み（SocketContext + WorldContext + PluginRegistry）でワールドを描画するが、
 * Socket 接続なしで definition から直接 entities を構築する。
 *
 * - プラグインは実際に Worker で動作する（pen tray, video controls などの本物の UI が見える）
 * - 各 entity wrapper は pointer-events: none を維持する（既存の EntityRenderer 仕様）
 * - 編集オーバーレイは `overlay` で渡し、その上に重ねる（pointer-events: auto を持つ）
 */
export function EditorPreview({ definition, overlay, fillContainer = false, hiddenIndices }: EditorPreviewProps) {
    const env = definition.spec.environment;
    const environment: WorldEnvironmentData = useMemo(
        () => ({
            backgroundColor: env?.backgroundColor ?? '#F0F8FF',
            backgroundImage: env?.backgroundImage ?? null,
            bgm: env?.bgm ?? null,
            worldSize: env?.worldSize ?? { width: 2000, height: 1500 },
        }),
        [env?.backgroundColor, env?.backgroundImage, env?.bgm, env?.worldSize],
    );

    const entities = useMemo(() => {
        const map = new Map<string, WorldEntity>();
        definition.spec.initialEntities.forEach((e, i) => {
            // 非表示中のエンティティはプラグイン本体ごと除外する（worker も起動しない）
            if (hiddenIndices?.has(i)) return;
            const t = e.transform;
            map.set(makeEditorEntityId(i), {
                id: makeEditorEntityId(i),
                type: e.kind,
                ownerId: null,
                lockedBy: null,
                data: (e.data as Record<string, unknown> | undefined) ?? {},
                transform: {
                    x: t.x,
                    y: t.y,
                    z: t.z ?? 0,
                    w: t.w ?? 0,
                    h: t.h ?? 0,
                    scale: t.scale ?? 1,
                    rotation: t.rotation ?? 0,
                },
            });
        });
        return map;
    }, [definition.spec.initialEntities, hiddenIndices]);

    const activePlugins = useMemo(() => {
        const set = new Set<string>();
        for (const e of definition.spec.initialEntities) {
            const colon = e.kind.indexOf(':');
            set.add(colon === -1 ? e.kind : e.kind.slice(0, colon));
        }
        return Array.from(set);
    }, [definition.spec.initialEntities]);

    const worldValue: WorldContextType = useMemo(
        () => ({
            entities,
            ephemeralData: new Map(),
            environment,
            availableKinds: [],
            activePlugins,
            // エディタは entity 操作を hook 経由で許可しない（編集はオーバーレイで definition を直接書き換える）
            createEntity: async () => null,
            patchEntity: () => {
                /* no-op */
            },
            deleteEntity: () => {
                /* no-op */
            },
            resetWorld: () => {
                /* no-op */
            },
            isConnected: true,
        }),
        [entities, environment, activePlugins],
    );

    const socketValue: SocketContextValue = useMemo(
        () => ({
            socket: null,
            isConnected: true,
            users: new Map(),
            currentUser: null,
            error: null,
            joinWorld: () => {
                /* no-op */
            },
            leaveWorld: () => {
                /* no-op */
            },
            updatePosition: () => {
                /* no-op */
            },
            updateStatus: () => {
                /* no-op */
            },
            updateUser: () => {
                /* no-op */
            },
        }),
        [],
    );

    return (
        <div
            style={{
                position: 'relative',
                overflow: 'auto',
                height: fillContainer ? '100%' : '70vh',
                backgroundColor: environment.backgroundColor,
                backgroundImage: environment.backgroundImage ? `url(${environment.backgroundImage})` : undefined,
                backgroundSize: 'cover',
                backgroundPosition: 'center center',
                borderRadius: fillContainer ? 0 : 12,
            }}
        >
            <SocketContext.Provider value={socketValue}>
                <WorldContext.Provider value={worldValue}>
                    <PluginRegistryProvider>
                        <PreviewStage entities={entities} environment={environment} overlay={overlay} />
                    </PluginRegistryProvider>
                </WorldContext.Provider>
            </SocketContext.Provider>
        </div>
    );
}

/**
 * world 座標系の絶対配置レイヤー。
 * 既存の EntityRenderer / WorkerPluginHost をそのまま使ってプラグインを動作させる。
 */
function PreviewStage({
    entities,
    environment,
    overlay,
}: {
    entities: Map<string, WorldEntity>;
    environment: WorldEnvironmentData;
    overlay?: React.ReactNode;
}) {
    const { pluginMap } = usePluginRegistry();

    const renderEntities = useMemo(
        () => Array.from(entities.keys()).map((id) => <EntityRenderer key={id} entityId={id} />),
        [entities],
    );

    const singletonWorkerPlugins = useMemo(
        () => Array.from(pluginMap.values()).filter((p) => isWorkerPlugin(p) && p.singleton),
        [pluginMap],
    );

    const { width, height } = environment.worldSize;

    return (
        <div
            style={{
                position: 'relative',
                width,
                height,
                minWidth: '100%',
                minHeight: '100%',
            }}
        >
            {renderEntities}
            {singletonWorkerPlugins.map((plugin) => {
                if (!isWorkerPlugin(plugin)) return null;
                const entity = Array.from(entities.values()).find((e) => e.type === plugin.id) ?? FALLBACK_ENTITY;
                const { x, y, z, w, h } = entity.transform;
                return (
                    <div
                        key={plugin.id}
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
                        <WorkerPluginHost entityId={`singleton:${plugin.id}`} entity={entity} definition={plugin} />
                    </div>
                );
            })}
            {overlay}
        </div>
    );
}
