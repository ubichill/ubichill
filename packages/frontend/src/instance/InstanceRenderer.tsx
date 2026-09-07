import type { WorkerModDefinition } from '@ubichill/react';
import {
    HoldProvider,
    isWorkerMod,
    RideProvider,
    useHold,
    useSocket,
    useWorld,
    useWorldSimulation,
    WorkerModHost,
} from '@ubichill/react';
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
    return (
        <RideProvider>
            <HoldProvider>
                <InstanceSurface />
            </HoldProvider>
        </RideProvider>
    );
};

/**
 * ワールド + 画面固定 HUD の描画面。
 * `useHold` を読むため HoldProvider の内側に置く（Provider と同じ階層では読めない）。
 */
const InstanceSurface: React.FC = () => {
    const { isConnected } = useSocket();
    const { entities, environment, activeMods } = useWorld();
    const { modMap } = useModRegistry();
    const { held } = useHold();

    // ワールドの進行（collider の接触判定）を Host の単一ループに載せる。
    // これにより mod 側は判定ループを書かずに collision:enter / collision:exit を受け取れる。
    useWorldSimulation(entities);

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

    // overlay: true の Entity は画面固定 HUD として、ワールドスクロールの外側に描画する。
    // Entity ごとの値 (World Editor の Inspector で上書き可能) が正本で、mod の manifest 側の
    // overlay は Component 追加時の既定値としてのみ使う（EntityInspector/ComponentCard 側で反映）。
    const { worldEntityIds, overlayEntityIds } = useMemo(() => {
        const world: string[] = [];
        const overlay: string[] = [];
        for (const [id, entity] of entities) {
            (entity.overlay ? overlay : world).push(id);
        }
        return { worldEntityIds: world, overlayEntityIds: overlay };
    }, [entities]);

    const renderEntities = useMemo(
        () => worldEntityIds.map((id) => <EntityRenderer key={id} entityId={id} />),
        [worldEntityIds],
    );
    const renderOverlayEntities = useMemo(
        () => overlayEntityIds.map((id) => <EntityRenderer key={id} entityId={id} />),
        [overlayEntityIds],
    );

    const { width: worldWidth, height: worldHeight } = environment.worldSize;

    if (!isConnected) {
        return null;
    }

    return (
        <>
            <div
                data-scroll-world
                data-ubi-mod-surface
                style={{
                    position: 'fixed',
                    inset: 0,
                    overflow: 'auto',
                    backgroundColor: environment.backgroundColor,
                    zIndex: Z_INDEX.INSTANCE_FRAME,
                    // 何かを持っている間（ペンを持って描く等）は、指のドラッグを mod の操作として
                    // 扱う。既定のままだとブラウザがパン(スクロール)ジェスチャと解釈して
                    // pointercancel を発火させ、ドラッグ操作が最初の一筆で途切れてしまう。
                    touchAction: held ? 'none' : undefined,
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
            {/* overlay: true の Entity 専用レイヤー。data-scroll-world の外側に置くことで
                    スクロール座標の影響を受けない画面固定 HUD として振る舞う。 */}
            <div
                data-ubi-mod-surface
                style={{
                    position: 'fixed',
                    inset: 0,
                    zIndex: Z_INDEX.ENTITY_OVERLAY,
                    pointerEvents: 'none',
                }}
            >
                {renderOverlayEntities}
            </div>
        </>
    );
};
