import type { VNode } from '@ubichill/shared';
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
    showToast(text: string): void;
    render(factory: () => VNode, targetId?: string): void;
    renderEntity(entityId: string, componentName: string, factory: () => VNode): void;
    unmount(targetId?: string): void;
    unmountEntity(entityId: string, componentName: string): void;
    getRenderStats(): UiRenderCostStat[];
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
): UiModule {
    const uiRenderQueue = new Map<string, VNode | null>();
    const uiTargetScope = new Map<string, { entityId: string; componentName: string }>();
    const uiRenderStats = new Map<string, UiRenderStatEntry>();
    let uiFlushScheduled = false;

    const flushUiRenderQueue = (): void => {
        if (uiRenderQueue.size === 0) return;
        for (const [targetId, vnode] of uiRenderQueue) {
            send({ type: 'UI_RENDER', payload: { targetId, vnode } });
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
        const vnode = factory();
        recordUiRenderCost(targetId, performance.now() - start, scope);
        queueUiRender(targetId, vnode);
    };

    const unmountUi = (targetId: string): void => {
        clearTarget(targetId);
        queueUiRender(targetId, null);
    };

    return {
        showToast: (text) => send({ type: 'UI_SHOW_TOAST', payload: { text } }),
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
