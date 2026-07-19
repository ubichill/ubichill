import type { ModGuestCommand, VNode } from '@ubichill/shared';

export type { VNode };

export type OmitId<T> = T extends unknown ? Omit<T, 'id'> : never;

export type SendFn = (cmd: OmitId<ModGuestCommand>) => void;
export type RpcFn = <T>(cmd: OmitId<ModGuestCommand>) => Promise<T>;

export type UiRenderCostStat = {
    targetId: string;
    entityId?: string;
    componentName?: string;
    renderCount: number;
    totalFactoryMs: number;
    averageFactoryMs: number;
    maxFactoryMs: number;
    lastFactoryMs: number;
    lastRenderedAt: number;
};

export type PresenceEntry = {
    id: string;
    worldX: number;
    worldY: number;
    sharedState: Record<string, unknown>;
};

export interface StateBinding {
    readonly watchType: string;
    getTargetId(): string | null;
    trySetTargetId(id: string): void;
    /** entity.data 部分 (Ubi.state.persistent / persistMine 用) を流し込む。 */
    applyEntityData(data: Record<string, unknown>): void;
    /** ComponentInstance 全体 (lockedBy / ownerId / transform 等の top-level も含む) を流し込む。 */
    applyEntity(entity: import('@ubichill/shared').ComponentInstance): void;
}

export type EntityStateFor<T extends Record<string, unknown>> = {
    readonly id: string;
    readonly worldX: number;
    readonly worldY: number;
    readonly viewportX: number;
    readonly viewportY: number;
} & { readonly [P in keyof T]: T[P] };

export interface EntityState<T extends Record<string, unknown>> {
    readonly local: T;
    for(userId: string): EntityStateFor<T>;
    onChange<K extends keyof T & string>(key: K, listener: (next: T[K], prev: T[K]) => void): void;
    renderForEachUser(componentName: string, factory: (state: EntityStateFor<T>) => VNode | null): void;
    /**
     * 複数キーの書き込みを 1 トランザクションとして扱う。
     * - 同一キー複数回書き込みは onChange を 1 回 (最新値) にまとめる
     * - sync 系の broadcast / persist flush は元々 tick 末尾にまとめられているので追加効果なし
     * - 主目的は「書き込みのたびに render() が走って同 tick 内で何度も VNode 生成される」のを防ぐ
     *
     * ```ts
     * state.batch(() => {
     *   state.local.currentTime = 0;
     *   state.local.duration = 0;
     *   state.local.lastSyncedTime = 0;
     * });
     * ```
     */
    batch(fn: () => void): void;
}
