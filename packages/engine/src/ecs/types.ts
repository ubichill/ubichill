/**
 * Ubichill ECS (Entity Component System)
 */

export interface ComponentDefinition<T = unknown> {
    readonly name: string;
    readonly default: T;
}

export interface Entity {
    readonly id: string;

    getComponent<T = unknown>(name: string): T | null;
    setComponent<T = unknown>(name: string, data: T): void;
    hasComponent(name: string): boolean;

    readonly _componentNames: Set<string>;
}

export type System = (entities: Entity[], deltaTime: number, events: WorkerEvent[]) => void;

export interface Query {
    execute(): Entity[];
    changed(): Entity[];
}

export interface EcsWorld {
    registerSystem(system: System): void;
    createEntity(id: string): Entity;
    getEntity(id: string): Entity | null;
    query(componentNames: string[]): Query;
    tick(deltaTime: number, events?: WorkerEvent[]): void;
    dispatch(event: WorkerEvent): void;
    clear(): void;
}

export interface WorkerEvent {
    type: string;
    entityId?: string;
    payload?: unknown;
    timestamp?: number;
}

/**
 * Host → Worker の組み込みイベント型定数。
 * ECS System 内で `event.type` と比較して使用する。
 */
export const EcsEventType = {
    PLAYER_JOINED: 'player:joined',
    PLAYER_LEFT: 'player:left',
    PLAYER_CURSOR_MOVED: 'player:cursor_moved',
    ENTITY_UPDATED: 'entity:updated',
    /** 入力イベント — Host が毎フレーム全 Worker へ配信 */
    INPUT_MOUSE_MOVE: 'input:mouse_move',
    INPUT_MOUSE_DOWN: 'input:mouse_down',
    INPUT_MOUSE_UP: 'input:mouse_up',
    INPUT_KEY_DOWN: 'input:key_down',
    INPUT_KEY_UP: 'input:key_up',
    /** 右クリック（コンテキストメニュー）— payload: { x, y } */
    INPUT_CONTEXT_MENU: 'input:context_menu',
    /** スクロール — payload: { x: scrollLeft, y: scrollTop } */
    INPUT_SCROLL: 'input:scroll',
    /** ウィンドウリサイズ — payload: { width: number; height: number } */
    INPUT_RESIZE: 'input:resize',
    /**
     * 他ユーザーの Worker が Ubi.network.broadcast() で送ったデータ。
     * payload: { userId: string; data: unknown }
     * event.type が broadcast の type 文字列になるため、このキーで比較するのではなく
     * broadcast 時に指定した type 文字列で比較すること。
     */
    NETWORK_BROADCAST: 'network:broadcast',
    /** OffscreenCanvas のリサイズ通知。payload: { targetId: string; width: number; height: number } */
    CANVAS_RESIZE: 'canvas:resize',
    /**
     * Host からプラグイン Worker へのカスタムメッセージ。
     * payload: { type: string; payload: unknown }
     * GenericPluginHost の sendHostMessage() で送信する。
     */
    HOST_MESSAGE: 'host:message',
} as const;
