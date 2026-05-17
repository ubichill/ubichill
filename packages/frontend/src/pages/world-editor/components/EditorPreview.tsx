import {
    isWorkerPlugin,
    SocketContext,
    type SocketContextValue,
    WorkerPluginHost,
    WorldContext,
    type WorldContextType,
} from '@ubichill/sdk/react';
import type { InitialEntity, WorldDefinition, WorldEntity, WorldEnvironmentData } from '@ubichill/shared';
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

/** 編集モード用エンティティ ID: `edit-${rootIndex}[-childIdx...]*-c${componentIndex}` */
export function makeEditorEntityId(rootEntityIndex: number, componentIndex: number, childPath: number[] = []): string {
    const path = [rootEntityIndex, ...childPath];
    return `edit-${path.join('-')}-c${componentIndex}`;
}

export function parseEditorEntityIndex(id: string): number | null {
    if (!id.startsWith('edit-')) return null;
    const n = Number.parseInt(id.slice('edit-'.length).split('-')[0] ?? '', 10);
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
    /** > 0 のとき world 領域に grid 線 (px) を描画する。 */
    gridStep?: number;
    /** プレビュー領域の背景（プラグイン UI なし）クリック時のハンドラ */
    onBackgroundMouseDown?: () => void;
}

/**
 * インスタンスページと同じ仕組み（SocketContext + WorldContext + PluginRegistry）でワールドを描画するが、
 * Socket 接続なしで definition から直接 entities を構築する。
 *
 * - プラグインは実際に Worker で動作する（pen tray, video controls などの本物の UI が見える）
 * - 各 entity wrapper は pointer-events: none を維持する（既存の EntityRenderer 仕様）
 * - 編集オーバーレイは `overlay` で渡し、その上に重ねる（pointer-events: auto を持つ）
 */
export function EditorPreview({
    definition,
    overlay,
    fillContainer = false,
    hiddenIndices,
    gridStep,
    onBackgroundMouseDown,
}: EditorPreviewProps) {
    const env = definition.spec.environment;
    const environment: WorldEnvironmentData = useMemo(
        () => ({
            backgroundColor: env?.backgroundColor ?? '#F0F8FF',
            worldSize: env?.worldSize ?? { width: 2000, height: 1500 },
        }),
        [env?.backgroundColor, env?.worldSize],
    );

    const entities = useMemo(() => {
        const map = new Map<string, WorldEntity>();
        const walk = (
            entity: InitialEntity,
            origin: { x: number; y: number; z: number },
            pathPrefix: number[],
            parentGameObjectId: string | undefined,
        ) => {
            const t = entity.transform;
            const absX = origin.x + t.x;
            const absY = origin.y + t.y;
            const absZ = origin.z + (t.z ?? 0);
            const transform: WorldEntity['transform'] = {
                x: absX,
                y: absY,
                z: absZ,
                w: t.w ?? 0,
                h: t.h ?? 0,
                scale: t.scale ?? 1,
                rotation: t.rotation ?? 0,
            };
            entity.components.forEach((c, ci) => {
                const id = `edit-${pathPrefix.join('-')}-c${ci}`;
                map.set(id, {
                    id,
                    type: c.type,
                    gameObjectId: entity.id,
                    parentGameObjectId,
                    ownerId: null,
                    lockedBy: null,
                    data: (c.data as Record<string, unknown> | undefined) ?? {},
                    transform,
                });
            });
            entity.children?.forEach((child, childIdx) => {
                walk(child, { x: absX, y: absY, z: absZ }, [...pathPrefix, childIdx], entity.id);
            });
        };
        definition.spec.initialEntities.forEach((e, ei) => {
            if (hiddenIndices?.has(ei)) return;
            walk(e, { x: 0, y: 0, z: 0 }, [ei], undefined);
        });
        return map;
    }, [definition.spec.initialEntities, hiddenIndices]);

    const activePlugins = useMemo(() => {
        const set = new Set<string>();
        const walk = (e: InitialEntity) => {
            for (const c of e.components) {
                const colon = c.type.indexOf(':');
                set.add(colon === -1 ? c.type : c.type.slice(0, colon));
            }
            e.children?.forEach(walk);
        };
        definition.spec.initialEntities.forEach(walk);
        return Array.from(set);
    }, [definition.spec.initialEntities]);

    const worldValue: WorldContextType = useMemo(
        () => ({
            entities,
            ephemeralData: new Map(),
            environment,
            availableComponents: [],
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
            onMouseDown={(e) => {
                if (e.target === e.currentTarget) onBackgroundMouseDown?.();
            }}
            style={{
                position: 'relative',
                overflow: 'auto',
                height: fillContainer ? '100%' : '70vh',
                backgroundColor: environment.backgroundColor,
                borderRadius: fillContainer ? 0 : 12,
                // プラグインが大きな z-index (例: avatar:cursor=10100) を持つので、
                // プレビュー外（ヒエラルキー / インスペクタ / アセット等）に漏れて
                // それらを覆わないよう、独立したスタッキングコンテキストに閉じ込める。
                isolation: 'isolate',
            }}
        >
            <SocketContext.Provider value={socketValue}>
                <WorldContext.Provider value={worldValue}>
                    <PluginRegistryProvider>
                        <PreviewStage
                            entities={entities}
                            environment={environment}
                            overlay={overlay}
                            gridStep={gridStep}
                            onBackgroundMouseDown={onBackgroundMouseDown}
                        />
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
    gridStep,
    onBackgroundMouseDown,
}: {
    entities: Map<string, WorldEntity>;
    environment: WorldEnvironmentData;
    overlay?: React.ReactNode;
    gridStep?: number;
    onBackgroundMouseDown?: () => void;
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
            onMouseDown={(e) => {
                if (e.target === e.currentTarget) onBackgroundMouseDown?.();
            }}
            style={{
                position: 'relative',
                width,
                height,
                minWidth: '100%',
                minHeight: '100%',
            }}
        >
            {/* ワールド範囲の境界 + (snap ON 時のみ) グリッド線 */}
            <div
                aria-hidden
                style={{
                    position: 'absolute',
                    left: 0,
                    top: 0,
                    width,
                    height,
                    border: '2px dashed rgba(27, 42, 68, 0.35)',
                    pointerEvents: 'none',
                    zIndex: 98999,
                    backgroundImage:
                        gridStep && gridStep > 0
                            ? `linear-gradient(to right, rgba(27,42,68,0.12) 1px, transparent 1px), linear-gradient(to bottom, rgba(27,42,68,0.12) 1px, transparent 1px)`
                            : undefined,
                    backgroundSize: gridStep && gridStep > 0 ? `${gridStep}px ${gridStep}px` : undefined,
                }}
            />
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
