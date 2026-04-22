import type { PluginGuestCommand, VNode } from '@ubichill/shared';

export type { VNode };

export type OmitId<T> = T extends unknown ? Omit<T, 'id'> : never;

export type SendFn = (cmd: OmitId<PluginGuestCommand>) => void;
export type RpcFn = <T>(cmd: OmitId<PluginGuestCommand>) => Promise<T>;

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
    applyEntityData(data: Record<string, unknown>): void;
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
}
