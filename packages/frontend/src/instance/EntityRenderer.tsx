import { isWorkerPlugin, useHold, useSocket, useWorld, WorkerPluginHost } from '@ubichill/react';
import type React from 'react';
import { useEffect, useRef } from 'react';
import { Z_INDEX } from '@/styles/layers';
import { usePluginRegistry } from '../plugins/PluginRegistryContext';
import { HeldEntityPositionRegistry } from './HeldEntityPositionRegistry';

interface EntityRendererProps {
    entityId: string;
}

/**
 * Worker プラグイン エンティティ用ホスト。
 *
 * 通常: useSocket を購読しないことでカーソル移動などの再レンダーを避ける。
 *
 * 「持っている」状態のとき:
 *  - 自分が持っている: pointermove を直接 listen して div.style を更新（React 再レンダーなし）
 *  - 他ユーザーが持っている: HeldEntityPositionRegistry から通知を受けて div.style を更新
 *
 * いずれも既存の WorkerPluginHost (= Worker プロセス) はそのまま使うため、
 * 新しい Worker は起動しない。DOM ノードの position を変えるだけ。
 */
export const EntityRenderer: React.FC<EntityRendererProps> = ({ entityId }) => {
    const { entities } = useWorld();
    const { pluginMap, loadPlugin } = usePluginRegistry();

    const entity = entities.get(entityId);
    const entityType = entity?.type;
    const plugin = entityType ? pluginMap.get(entityType) : undefined;

    // avoid starting network loads during render — schedule via effect
    useEffect(() => {
        if (entityType && !plugin) loadPlugin(entityType);
    }, [plugin, entityType, loadPlugin]);

    if (!entity) return null;
    if (!plugin) return null;
    if (!isWorkerPlugin(plugin)) return null;
    // singleton は InstanceRenderer 側で起動するためここではスキップ
    if (plugin.singleton) return null;

    return <EntityRendererInner entityId={entityId} />;
};

/**
 * Inner コンポーネント: エンティティが存在することが確定してから
 * held 状態のフックを呼ぶ（Rules of Hooks 対応）。
 */
const EntityRendererInner: React.FC<EntityRendererProps> = ({ entityId }) => {
    const { entities } = useWorld();
    const { pluginMap } = usePluginRegistry();
    const { held, heldRef } = useHold();
    const { currentUser, users } = useSocket();
    const divRef = useRef<HTMLDivElement>(null);

    // hook の呼び出し順序を Rules of Hooks に揃えるため、null guard は最後に行う。
    // 途中の値は entity/plugin が無くてもデフォルトを保つように書く。
    const entity = entities.get(entityId);
    const plugin = entity ? pluginMap.get(entity.type) : null;
    const isWorker = plugin !== undefined && plugin !== null && isWorkerPlugin(plugin);

    // 自分が持っているか
    const isHeldByMe = !!entity && held?.entityId === entityId;
    // 他ユーザーが持っているか（lockedBy が自分以外 + data.isHeld が true）
    const isHeldByOther =
        !!entity &&
        !isHeldByMe &&
        entity.lockedBy !== null &&
        entity.lockedBy !== currentUser?.id &&
        (entity.data as Record<string, unknown>).isHeld === true;

    const holderId = isHeldByOther && entity ? entity.lockedBy : null;

    // ── 自分が持っているとき: pointermove で CSS 変数のみ更新 (zIndex などは wrapperStyle 経由で React 管理) ──
    // biome-ignore lint/correctness/useExhaustiveDependencies: entity の transform.x/y のみ追跡したい (entity 全体を入れると毎更新で再 subscribe)
    useEffect(() => {
        if (!isHeldByMe || !entity) return;
        const div = divRef.current;
        if (!div) return;
        const baseX = entity.transform.x;
        const baseY = entity.transform.y;

        const onMove = (e: PointerEvent) => {
            const h = heldRef.current;
            if (!h || h.entityId !== entityId) return;

            const scrollEl = document.querySelector('[data-scroll-world]') as HTMLElement | null;
            const sx = scrollEl?.scrollLeft ?? 0;
            const sy = scrollEl?.scrollTop ?? 0;
            const targetX = e.clientX + sx + h.offsetX;
            const targetY = e.clientY + sy + h.offsetY;

            div.style.setProperty('--held-dx', `${targetX - baseX}px`);
            div.style.setProperty('--held-dy', `${targetY - baseY}px`);
        };

        // 初期位置を現在のマウス位置で即時セット
        const initOffsetX = held?.offsetX ?? -24;
        const initOffsetY = held?.offsetY ?? 0;
        const w = window as Window & { _lastMouseX?: number; _lastMouseY?: number };
        const scrollEl = document.querySelector('[data-scroll-world]') as HTMLElement | null;
        const sx = scrollEl?.scrollLeft ?? 0;
        const sy = scrollEl?.scrollTop ?? 0;
        const initialX = (w._lastMouseX ?? 0) + sx + initOffsetX;
        const initialY = (w._lastMouseY ?? 0) + sy + initOffsetY;

        div.style.setProperty('--held-dx', `${initialX - baseX}px`);
        div.style.setProperty('--held-dy', `${initialY - baseY}px`);

        window.addEventListener('pointermove', onMove);
        return () => {
            window.removeEventListener('pointermove', onMove);
            // CSS 変数だけクリア。zIndex / pointerEvents は wrapperStyle が React 経由で復元する
            div.style.removeProperty('--held-dx');
            div.style.removeProperty('--held-dy');
        };
    }, [isHeldByMe, entityId, held?.offsetX, held?.offsetY, heldRef, entity?.transform.x, entity?.transform.y]);

    // ── 他ユーザーが持っているとき: HeldEntityPositionRegistry で CSS 変数のみ更新 ──
    // biome-ignore lint/correctness/useExhaustiveDependencies: users / entity 全体は初期参照だけ。subscribe 後は registry が逐次更新するので deps では transform.x/y のみ追跡する
    useEffect(() => {
        if (!isHeldByOther || !holderId || !entity) return;
        const div = divRef.current;
        if (!div) return;
        const baseX = entity.transform.x;
        const baseY = entity.transform.y;

        // 初期位置: 既知のユーザー座標から計算
        const holderUser = users.get(holderId);
        if (holderUser) {
            const targetX = holderUser.position.x - 24;
            const targetY = holderUser.position.y;
            div.style.setProperty('--held-dx', `${targetX - baseX}px`);
            div.style.setProperty('--held-dy', `${targetY - baseY}px`);
        }

        // Registry に登録: cursor:moved で座標が更新されるたびに呼ばれる
        const unsub = HeldEntityPositionRegistry.subscribe(entityId, (worldX, worldY) => {
            div.style.setProperty('--held-dx', `${worldX - baseX}px`);
            div.style.setProperty('--held-dy', `${worldY - baseY}px`);
        });

        return () => {
            unsub();
            // CSS 変数だけクリア。zIndex / opacity / transition は wrapperStyle が React 経由で復元する
            div.style.removeProperty('--held-dx');
            div.style.removeProperty('--held-dy');
        };
    }, [isHeldByOther, holderId, entityId, entity?.transform.x, entity?.transform.y]); // users は意図的に除外（初期値のみ使用）

    // null guard はすべての hook 呼び出しの後
    if (!entity || !plugin || !isWorker) return null;

    // ── スタイル計算 ──────────────────────────────────────────────────────
    const workerPlugin = plugin; // isWorkerPlugin チェック済み
    const isCanvas = (workerPlugin.canvasTargets?.length ?? 0) > 0;
    const { x, y, z, w, h, scale, rotation } = entity.transform;
    const sized = w > 0 && h > 0;

    // hold 状態を wrapperStyle に直接反映する。命令的に div.style.zIndex を書き換えると、
    // React が「前回 render と同じ値だから何もしない」と判断してリリース時に元の値が
    // 復元されないバグ (zIndex が style から消える) が出るため、すべて React 管理下に置く。
    // CSS 変数 (--held-dx/dy) のみ pointermove で imperative に更新する (60fps の都合)。
    const heldZ = isHeldByMe || isHeldByOther ? Z_INDEX.HELD_ENTITY : (z ?? 0) || undefined;
    const wrapperStyle: React.CSSProperties = isCanvas
        ? { position: 'absolute', inset: 0, zIndex: heldZ, pointerEvents: 'none' }
        : {
              position: 'absolute',
              left: x,
              top: y,
              zIndex: heldZ,
              width: w > 0 ? w : undefined,
              height: h > 0 ? h : undefined,
              overflow: sized ? 'hidden' : undefined,
              pointerEvents: 'none',
              opacity: isHeldByOther ? 0.85 : undefined,
              transition: isHeldByOther ? 'transform 80ms linear' : undefined,
              transform: `translate(var(--held-dx, 0px), var(--held-dy, 0px)) scale(${scale ?? 1}) rotate(${rotation ?? 0}deg)`,
              transformOrigin: '0 0',
          };

    return (
        <div ref={divRef} style={wrapperStyle}>
            <WorkerPluginHost entityId={entityId} entity={entity} definition={workerPlugin} />
        </div>
    );
};
