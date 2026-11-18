/**
 * ModRegistry — アクティブな全 Worker の「在籍簿」(repository 層)。
 *
 * 個々の Worker のライフサイクルは ModHostManager (usecase 層) が持ち、
 * ここは「今どの Worker が居て、Entity 階層上どう繋がっているか」だけを管理する。
 *
 * 責務:
 *  - register / unregister / get : 在籍の出入り
 *  - getActiveWorkerCount        : 総数 (メトリクス用)
 *  - routeEmit                   : Ubi.event.emit の配送先（scope / ref）の解決 → 対象 Worker へ配送
 *
 * module スコープの singleton。複数 ModHostManager が同一プロセスで共有する。
 */
import { HostEventType } from '@ubichill/shared';
import type { EmitRoute, ModWorkerInfo } from './types';

const _registry = new Map<string, ModWorkerInfo>();

export function registerWorker(instanceKey: string, info: ModWorkerInfo): void {
    _registry.set(instanceKey, info);
}

export function unregisterWorker(instanceKey: string): void {
    _registry.delete(instanceKey);
}

export function getWorker(instanceKey: string): ModWorkerInfo | undefined {
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

/** 配送先の選択に使う Worker の情報（`_sendEvent` を除く）。 */
export type EmitCandidate = Pick<
    ModWorkerInfo,
    'componentInstanceId' | 'entityId' | 'parentEntityId' | 'componentType' | 'refs'
>;

/**
 * emit の配送先を選ぶ純関数。送り手自身は常に除く。
 * - `ref`: 送り手の参照フィールドが指す Entity 上の Component。フィールドが `component` を宣言していればその型だけ。
 *   宣言の無いフィールド名・未設定のフィールドなら誰にも届かない。参照の値は data にあり、mod 自身や部屋の参加者も
 *   書き換えられる（`scope: 'world'` もある）ので、配線は届け先を選ぶ仕組みで、届く範囲を守る仕組みではない。
 * - `scope: 'referrers'`: 参照フィールドで送り手の Entity を指している Component。相手のフィールドが `component` を
 *   宣言していれば、それが送り手の型と一致するときだけ（同じ Entity の別の Component 宛ての参照には返さない）。
 * - そのほかの `scope`: Entity の階層で決める。
 */
export function selectEmitTargets<T extends EmitCandidate>(
    sender: EmitCandidate | undefined,
    all: readonly T[],
    route: EmitRoute,
    targetType: string | undefined,
): T[] {
    const others = all.filter(
        (w) => w.componentInstanceId !== sender?.componentInstanceId && (!targetType || w.componentType === targetType),
    );
    if (route.ref !== undefined) {
        const ref = sender?.refs().find((r) => r.field === route.ref);
        if (!ref) return [];
        return others.filter(
            (w) =>
                !!w.entityId &&
                ref.entityIds.includes(w.entityId) &&
                (!ref.component || w.componentType === ref.component),
        );
    }
    const senderEntityId = sender?.entityId;
    const senderParentId = sender?.parentEntityId;
    switch (route.scope) {
        case 'siblings':
            // 同じ parent を持つ別 Entity の Component（空の wrapper Entity の下の兄弟同士）
            return others.filter(
                (w) => !!senderParentId && w.parentEntityId === senderParentId && w.entityId !== senderEntityId,
            );
        case 'parent':
            return others.filter((w) => !!senderParentId && w.entityId === senderParentId);
        case 'children':
            return others.filter((w) => !!senderEntityId && w.parentEntityId === senderEntityId);
        case 'subtree': {
            if (!senderEntityId) return [];
            const subtree = subtreeEntityIds(senderEntityId, all);
            return others.filter(
                (w) =>
                    (!!w.entityId && subtree.has(w.entityId)) || (!!w.parentEntityId && subtree.has(w.parentEntityId)),
            );
        }
        case 'referrers':
            return senderEntityId
                ? others.filter((w) =>
                      w
                          .refs()
                          .some(
                              (r) =>
                                  r.entityIds.includes(senderEntityId) &&
                                  (!r.component || r.component === sender?.componentType),
                          ),
                  )
                : [];
        case 'world':
            return others;
        default:
            return [];
    }
}

/**
 * `Ubi.event.emit(type, data, { scope | ref, targetType })` の受信側へのルーティング。
 * 選んだ Worker 全てに `EVT_CUSTOM` で配送する。
 */
export function routeEmit(args: {
    senderComponentInstanceId: string | undefined;
    type: string;
    data: unknown;
    route: EmitRoute;
    targetType: string | undefined;
}): void {
    const { senderComponentInstanceId, type, data, route, targetType } = args;
    const all = Array.from(_registry.values());
    const sender = all.find((w) => w.componentInstanceId === senderComponentInstanceId);
    for (const target of selectEmitTargets(sender, all, route, targetType)) {
        target._sendEvent({ type: HostEventType.EVT_CUSTOM, payload: { eventType: type, data } });
    }
}

/**
 * 指定 Entity 上で動いている全 Worker へ、`Ubi.event` と同じ経路でイベントを届ける。
 * Host が確定させた事実（衝突など）を mod へ渡すのに使う。mod 側は emit と区別せず
 * `events.on(eventType)` で受け取れるので、専用のプロトコルを増やさずに済む。
 */
export function deliverToEntity(entityId: string, eventType: string, data: unknown): void {
    for (const worker of _registry.values()) {
        if (worker.entityId !== entityId) continue;
        worker._sendEvent({ type: HostEventType.EVT_CUSTOM, payload: { eventType, data } });
    }
}

/** rootEntityId と、その子孫の Entity の id（emit 1 回につき 1 度だけ、Worker の数に比例する手間で作る）。 */
function subtreeEntityIds(rootEntityId: string, all: readonly EmitCandidate[]): ReadonlySet<string> {
    const childrenOf = new Map<string, string[]>();
    for (const info of all) {
        if (!info.entityId || !info.parentEntityId) continue;
        const siblings = childrenOf.get(info.parentEntityId);
        if (siblings) siblings.push(info.entityId);
        else childrenOf.set(info.parentEntityId, [info.entityId]);
    }
    const subtree = new Set<string>([rootEntityId]);
    const pending = [rootEntityId];
    while (pending.length > 0) {
        for (const child of childrenOf.get(pending.pop() ?? '') ?? []) {
            if (subtree.has(child)) continue;
            subtree.add(child);
            pending.push(child);
        }
    }
    return subtree;
}
