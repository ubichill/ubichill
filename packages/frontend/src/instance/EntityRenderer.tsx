import { isWorkerPlugin, useHold, useSocket, useWorld, WorkerPluginHost } from '@ubichill/sdk/react';
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
    if (!entity) return null;

    const plugin = pluginMap.get(entity.type);
    if (!plugin) {
        loadPlugin(entity.type);
        return null;
    }
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

    // ── 自分が持っているとき: pointermove で直接 DOM 更新 ──────────────────
    useEffect(() => {
        if (!isHeldByMe) return;
        const div = divRef.current;
        if (!div) return;

        div.style.position = 'fixed';
        div.style.zIndex = String(Z_INDEX.HELD_ENTITY);
        div.style.pointerEvents = 'none';

        const onMove = (e: PointerEvent) => {
            const h = heldRef.current;
            if (!h || h.entityId !== entityId) return;
            div.style.left = `${e.clientX + h.offsetX}px`;
            div.style.top = `${e.clientY + h.offsetY}px`;
        };

        // 初期位置を現在のマウス位置で即時セット
        const initX = held?.offsetX ?? -24;
        const initY = held?.offsetY ?? 0;
        div.style.left = `${(window as Window & { _lastMouseX?: number })._lastMouseX ?? 0 + initX}px`;
        div.style.top = `${(window as Window & { _lastMouseY?: number })._lastMouseY ?? 0 + initY}px`;

        window.addEventListener('pointermove', onMove);
        return () => {
            window.removeEventListener('pointermove', onMove);
            // 解放時: fixed を解除して元の absolute に戻す
            div.style.position = '';
            div.style.zIndex = '';
            div.style.left = '';
            div.style.top = '';
            div.style.pointerEvents = '';
        };
    }, [isHeldByMe, entityId, held?.offsetX, held?.offsetY, heldRef]);

    // ── 他ユーザーが持っているとき: HeldEntityPositionRegistry で DOM 更新 ──
    // biome-ignore lint/correctness/useExhaustiveDependencies: users は初期位置の参照だけに最新値を読む (subscribe 後は registry が逐次更新する)
    useEffect(() => {
        if (!isHeldByOther || !holderId) return;
        const div = divRef.current;
        if (!div) return;

        div.style.position = 'fixed';
        div.style.zIndex = String(Z_INDEX.HELD_ENTITY);
        div.style.pointerEvents = 'none';
        div.style.opacity = '0.85';
        div.style.transition = 'left 80ms linear, top 80ms linear';

        // 初期位置: 既知のユーザー座標から計算
        const holderUser = users.get(holderId);
        if (holderUser) {
            const scrollEl = document.querySelector('[data-scroll-world]') as HTMLElement | null;
            const sx = scrollEl?.scrollLeft ?? 0;
            const sy = scrollEl?.scrollTop ?? 0;
            div.style.left = `${holderUser.position.x - sx - 24}px`;
            div.style.top = `${holderUser.position.y - sy}px`;
        }

        // Registry に登録: cursor:moved で座標が更新されるたびに呼ばれる
        const unsub = HeldEntityPositionRegistry.subscribe(entityId, (vx, vy) => {
            div.style.left = `${vx}px`;
            div.style.top = `${vy}px`;
        });

        return () => {
            unsub();
            div.style.position = '';
            div.style.zIndex = '';
            div.style.left = '';
            div.style.top = '';
            div.style.pointerEvents = '';
            div.style.opacity = '';
            div.style.transition = '';
        };
    }, [isHeldByOther, holderId, entityId]); // users は意図的に除外（初期値のみ使用）

    // null guard はすべての hook 呼び出しの後
    if (!entity || !plugin || !isWorker) return null;

    // ── スタイル計算 ──────────────────────────────────────────────────────
    const workerPlugin = plugin; // isWorkerPlugin チェック済み
    const isCanvas = (workerPlugin.canvasTargets?.length ?? 0) > 0;
    const { x, y, z, w, h, scale, rotation } = entity.transform;
    const sized = w > 0 && h > 0;

    // held 中は useEffect で直接スタイルを上書きするため、ここでは通常スタイルのみ定義
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
        <div ref={divRef} style={wrapperStyle}>
            <WorkerPluginHost entityId={entityId} entity={entity} definition={workerPlugin} />
        </div>
    );
};
