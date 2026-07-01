/**
 * PluginRegistry — アクティブな全 Worker の「在籍簿」(repository 層)。
 *
 * 個々の Worker のライフサイクルは PluginHostManager (usecase 層) が持ち、
 * ここは「今どの Worker が居て、Entity 階層上どう繋がっているか」だけを管理する。
 *
 * 責務:
 *  - register / unregister / get : 在籍の出入り
 *  - getActiveWorkerCount        : 総数 (メトリクス用)
 *  - routeEmit                   : Ubi.event.emit の scope 解決 → 対象 Worker へ配送
 *
 * module スコープの singleton。複数 PluginHostManager が同一プロセスで共有する。
 */
import { HostEventType } from '@ubichill/shared';
import type { EmitScope, PluginWorkerInfo } from './types';

const _registry = new Map<string, PluginWorkerInfo>();

export function registerWorker(instanceKey: string, info: PluginWorkerInfo): void {
    _registry.set(instanceKey, info);
}

export function unregisterWorker(instanceKey: string): void {
    _registry.delete(instanceKey);
}

export function getWorker(instanceKey: string): PluginWorkerInfo | undefined {
    return _registry.get(instanceKey);
}

/** アクティブ Worker 総数。 */
export function getActiveWorkerCount(): number {
    return _registry.size;
}

/**
 * テスト用: レジストリをリセットする。
 * テスト間でのレジストリ汚染を防ぐために使用する。プロダクションコードから呼ばない。
 * @internal
 */
export function resetRegistryForTests(): void {
    _registry.clear();
}

/**
 * `Ubi.event.emit(type, data, { scope, targetType })` の受信側へのルーティング。
 * sender 以外で scope + targetType に一致する Worker 全てに `EVT_CUSTOM` で配送する。
 */
export function routeEmit(args: {
    senderComponentInstanceId: string | undefined;
    type: string;
    data: unknown;
    scope: EmitScope;
    targetType: string | undefined;
}): void {
    const { senderComponentInstanceId, type, data, scope, targetType } = args;
    const all = Array.from(_registry.values());
    const sender = all.find((w) => w.componentInstanceId === senderComponentInstanceId);

    const matchesScope = (w: PluginWorkerInfo): boolean => {
        switch (scope) {
            case 'siblings':
                // Entity 階層レベル: 同じ parent を持つ別 Entity の Component。
                // 空の wrapper Entity の下にある兄弟 Entity 同士の通信を可能にする。
                return (
                    !!sender?.parentEntityId &&
                    w.parentEntityId === sender.parentEntityId &&
                    w.entityId !== sender.entityId
                );
            case 'parent':
                return !!sender?.parentEntityId && w.entityId === sender.parentEntityId;
            case 'children':
                return !!sender?.entityId && w.parentEntityId === sender.entityId;
            case 'subtree':
                return !!sender?.entityId && _isInSubtree(w, sender.entityId, all);
            case 'world':
                return true;
            default:
                return false;
        }
    };
    const targets = all.filter((w) => {
        if (w.componentInstanceId === senderComponentInstanceId) return false;
        if (targetType && w.componentType !== targetType) return false;
        return matchesScope(w);
    });

    for (const target of targets) {
        target._sendEvent({ type: HostEventType.EVT_CUSTOM, payload: { eventType: type, data } });
    }
}

/** w が rootEntityId をルートとする subtree (root + 子孫) に含まれるか。 */
function _isInSubtree(w: PluginWorkerInfo, rootEntityId: string, all: PluginWorkerInfo[]): boolean {
    if (w.entityId === rootEntityId) return true;
    const parentOf = new Map<string, string | undefined>();
    for (const info of all) {
        if (info.entityId) parentOf.set(info.entityId, info.parentEntityId);
    }
    let cur: string | undefined = w.parentEntityId;
    const seen = new Set<string>();
    while (cur && !seen.has(cur)) {
        if (cur === rootEntityId) return true;
        seen.add(cur);
        cur = parentOf.get(cur);
    }
    return false;
}
