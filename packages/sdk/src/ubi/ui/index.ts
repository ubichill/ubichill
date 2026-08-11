import { CommandType } from '@ubichill/shared/mod/protocol';
import type { VNode } from '@ubichill/shared/mod/vnode';
import type { KeyDescriptor, ReadTracker } from '../reactiveTracking';
import type { SendFn, UiRenderCostStat } from '../types';

type UiRenderStatEntry = {
    targetId: string;
    entityId?: string;
    componentName?: string;
    renderCount: number;
    totalFactoryMs: number;
    maxFactoryMs: number;
    lastFactoryMs: number;
    lastRenderedAt: number;
};

export type UiModule = {
    // ── Public API ────────────────────────────────────────
    /** 画面に一時的な通知（トースト）を表示する。 */
    showToast(text: string): void;
    /**
     * 自 Component の UI を描画する。`factory` 実行中に読んだ `Ubi.state` のキーを
     * 自動で追跡し、そのキーが変わったときだけ `factory` を再実行して再描画する
     * （読まなかったキーの変化では再描画しない。明示的な `onChange` での再呼び出しは不要）。
     * @param targetId 複数 UI を描き分けるときの識別子（省略時は `'default'`）。
     */
    render(factory: () => VNode, targetId?: string): void;
    /**
     * 指定 Entity/Component 名に紐づく UI を描画する（ユーザー別 UI など、自身以外の対象向け）。
     * 通常は `render` を使い、これは `state.renderForEachUser` 等の高度な用途に使う。
     */
    renderEntity(entityId: string, componentName: string, factory: () => VNode): void;
    /** `render` で描いた UI を取り外す（省略時は `'default'`）。 */
    unmount(targetId?: string): void;
    /** `renderEntity` で描いた UI を取り外す。 */
    unmountEntity(entityId: string, componentName: string): void;
    /** UI 再描画のコスト計測（レンダー回数・factory 実行時間）を取得する。パフォーマンス調査用。 */
    getRenderStats(): UiRenderCostStat[];
    /** 蓄積した再描画コスト計測をクリアする（`entityId` 指定でその Entity 分のみ）。 */
    clearRenderStats(entityId?: string): void;
    // ── Internal (UbiSDK assembler + state module から使用) ──
    _buildEntityTargetId(entityId: string, componentName: string): string;
    _queueUiRender(targetId: string, vnode: VNode | null): void;
    _flushUiRenderQueue(): void;
    _renderUi(factory: () => VNode, targetId: string, scope?: { entityId: string; componentName: string }): void;
    _unmountUi(targetId: string): void;
    _recordUiRenderCost(targetId: string, costMs: number, scope?: { entityId: string; componentName: string }): void;
};

export function createUiModule(
    send: SendFn,
    getIsTicking: () => boolean,
    beginRender: (targetId: string) => void,
    clearTarget: (targetId: string) => void,
    readTracker: ReadTracker,
): UiModule {
    const { beginTrackingReads, endTrackingReads } = readTracker;
    const uiRenderQueue = new Map<string, VNode | null>();
    const uiTargetScope = new Map<string, { entityId: string; componentName: string }>();
    const uiRenderStats = new Map<string, UiRenderStatEntry>();
    let uiFlushScheduled = false;

    // ── 自動再描画: targetId ごとに「前回の factory() 実行で読まれた state キー」を覚え、
    // 差分だけ subscribe/unsubscribe する（読むキーが変わらない限り再登録しない）。
    const uiAutoDeps = new Map<string, Set<KeyDescriptor>>();

    const reconcileAutoDeps = (targetId: string, next: Set<KeyDescriptor>, rerun: () => void): void => {
        const prev = uiAutoDeps.get(targetId);
        if (prev) for (const d of prev) if (!next.has(d)) d.unsubscribe(targetId);
        for (const d of next) if (!prev?.has(d)) d.subscribe(targetId, rerun);
        if (next.size > 0) uiAutoDeps.set(targetId, next);
        else uiAutoDeps.delete(targetId);
    };

    const flushUiRenderQueue = (): void => {
        if (uiRenderQueue.size === 0) return;
        for (const [targetId, vnode] of uiRenderQueue) {
            send({ type: CommandType.UI_RENDER, payload: { targetId, vnode } });
        }
        uiRenderQueue.clear();
    };

    const queueUiRender = (targetId: string, vnode: VNode | null): void => {
        uiRenderQueue.set(targetId, vnode);
        if (getIsTicking() || uiFlushScheduled) return;
        uiFlushScheduled = true;
        queueMicrotask(() => {
            uiFlushScheduled = false;
            if (!getIsTicking()) flushUiRenderQueue();
        });
    };

    const recordUiRenderCost = (
        targetId: string,
        costMs: number,
        scope?: { entityId: string; componentName: string },
    ): void => {
        if (scope) uiTargetScope.set(targetId, scope);
        const meta = uiTargetScope.get(targetId);
        const prev = uiRenderStats.get(targetId);
        uiRenderStats.set(targetId, {
            targetId,
            entityId: meta?.entityId,
            componentName: meta?.componentName,
            renderCount: (prev?.renderCount ?? 0) + 1,
            totalFactoryMs: (prev?.totalFactoryMs ?? 0) + costMs,
            maxFactoryMs: Math.max(prev?.maxFactoryMs ?? 0, costMs),
            lastFactoryMs: costMs,
            lastRenderedAt: Date.now(),
        });
    };

    const buildEntityTargetId = (entityId: string, componentName: string): string =>
        `entity:${entityId}:component:${componentName}`;

    const renderUi = (
        factory: () => VNode,
        targetId: string,
        scope?: { entityId: string; componentName: string },
    ): void => {
        const start = performance.now();
        beginRender(targetId);
        beginTrackingReads();
        let vnode: VNode;
        try {
            vnode = factory();
        } finally {
            // 今回読まれた state キーが変わったときだけ再登録する（`Ubi.state` 側が
            // 変化時にこの rerun を呼び直し、そのたびに依存が最新化される）。
            reconcileAutoDeps(targetId, endTrackingReads(), () => renderUi(factory, targetId, scope));
        }
        recordUiRenderCost(targetId, performance.now() - start, scope);
        queueUiRender(targetId, vnode);
    };

    const unmountUi = (targetId: string): void => {
        clearTarget(targetId);
        reconcileAutoDeps(targetId, new Set(), () => {});
        queueUiRender(targetId, null);
    };

    return {
        showToast: (text) => send({ type: CommandType.UI_SHOW_TOAST, payload: { text } }),
        render: (factory, targetId = 'default') => renderUi(factory, targetId),
        renderEntity: (entityId, componentName, factory) =>
            renderUi(factory, buildEntityTargetId(entityId, componentName), { entityId, componentName }),
        unmount: (targetId = 'default') => unmountUi(targetId),
        unmountEntity: (entityId, componentName) => unmountUi(buildEntityTargetId(entityId, componentName)),
        getRenderStats: () => {
            const out: UiRenderCostStat[] = [];
            for (const stat of uiRenderStats.values()) {
                out.push({
                    ...stat,
                    averageFactoryMs: stat.renderCount > 0 ? stat.totalFactoryMs / stat.renderCount : 0,
                });
            }
            return out.sort((a, b) => b.totalFactoryMs - a.totalFactoryMs);
        },
        clearRenderStats: (entityId) => {
            if (!entityId) {
                uiRenderStats.clear();
                uiTargetScope.clear();
                return;
            }
            for (const [targetId, stat] of uiRenderStats) {
                if (stat.entityId === entityId) {
                    uiRenderStats.delete(targetId);
                    uiTargetScope.delete(targetId);
                }
            }
        },
        _buildEntityTargetId: buildEntityTargetId,
        _queueUiRender: queueUiRender,
        _flushUiRenderQueue: flushUiRenderQueue,
        _renderUi: renderUi,
        _unmountUi: unmountUi,
        _recordUiRenderCost: recordUiRenderCost,
    };
}
