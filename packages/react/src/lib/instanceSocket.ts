import type { ClientToServerEvents, InstanceAPI, ServerToClientEvents } from '@ubichill/shared';

type Events = ServerToClientEvents & {
    connect: () => void;
    disconnect: () => void;
    connect_error: (error: Error) => void;
};
type Listener = (...args: unknown[]) => void;
type Join = Parameters<ClientToServerEvents['world:join']>[0];
type JoinReply = Parameters<Parameters<ClientToServerEvents['world:join']>[1]>[0];
export type InstanceGrant = InstanceAPI['schemas']['InstanceGrant'];
export type ResolveInstance = (instanceId: string, password?: string) => Promise<InstanceGrant>;
interface Frame {
    event?: string;
    data?: unknown;
    id?: string;
    replyTo?: string;
}

/** Typed instance transport. Disconnected operations are never replayed: a fresh
 * snapshot restores state after reconnect. Only joining is retried automatically. */
export class InstanceSocket {
    connected = false;
    id: string | undefined;
    private ws: WebSocket | null = null;
    private listeners = new Map<string, Set<Listener>>();
    private pending = new Map<string, { callback: Listener; timer: ReturnType<typeof setTimeout> }>();
    private joined: { data: Join; callback: (result: JoinReply) => void } | null = null;
    private retry: ReturnType<typeof setTimeout> | undefined;
    private generation = 0;
    private attempts = 0;

    constructor(private readonly resolveInstance: ResolveInstance) {}

    on<K extends keyof Events>(event: K, listener: Events[K]): this {
        const set = this.listeners.get(event) ?? new Set<Listener>();
        set.add(listener as Listener);
        this.listeners.set(event, set);
        return this;
    }
    off<K extends keyof Events>(event: K, listener: Events[K]): this {
        this.listeners.get(event)?.delete(listener as Listener);
        return this;
    }
    private dispatch(event: string, ...args: unknown[]) {
        for (const listener of this.listeners.get(event) ?? []) listener(...args);
    }
    emit<K extends keyof ClientToServerEvents>(event: K, ...args: Parameters<ClientToServerEvents[K]>): this {
        if (event === 'world:join') {
            this.disconnect();
            this.joined = { data: args[0] as Join, callback: args[1] as (result: JoinReply) => void };
            void this.open();
            return this;
        }
        if (event === 'world:leave') this.joined = null;
        if (this.joined && event === 'cursor:move') {
            this.joined.data.user.position = (args[0] as Parameters<ClientToServerEvents['cursor:move']>[0]).position;
        }
        if (this.joined && event === 'status:update') this.joined.data.user.status = args[0] as Join['user']['status'];
        const values = [...args] as unknown[];
        const last = values.at(-1);
        const callback = typeof last === 'function' ? (values.pop() as Listener) : undefined;
        this.send(event, values[0], callback);
        return this;
    }
    private send(event: string, data: unknown, callback?: Listener) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            callback?.({ success: false, error: '接続が切れています', timeline: null });
            return;
        }
        // A stale cursor/ephemeral update can be dropped before entering TCP's queue.
        if ((event === 'cursor:move' || event === 'entity:ephemeral') && this.ws.bufferedAmount > 65536) return;
        const id = callback ? crypto.randomUUID() : undefined;
        if (id && callback) {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                callback({ success: false, error: '応答がタイムアウトしました', timeline: null });
            }, 10000);
            this.pending.set(id, { callback, timer });
        }
        this.ws.send(JSON.stringify({ event, data, id }));
    }
    private async open() {
        const generation = ++this.generation;
        const joined = this.joined;
        if (!joined) return;
        try {
            const grant = await this.resolveInstance(joined.data.instanceId, joined.data.password);
            if (generation !== this.generation) return;
            if (grant.protocolVersion !== 1) throw new Error('非対応の通信バージョンです');
            const url = new URL(grant.url, window.location.href);
            url.protocol = url.protocol === 'https:' || url.protocol === 'wss:' ? 'wss:' : 'ws:';
            const ws = new WebSocket(url);
            this.ws = ws;
            // The bearer ticket travels in the first frame, never in a URL or cookie.
            const handshake = setTimeout(() => ws.close(), 10000);
            ws.onopen = () => {
                if (generation !== this.generation) return;
                this.send('world:join', { ...joined.data, token: grant.token }, (value) => {
                    if (generation !== this.generation) return;
                    clearTimeout(handshake);
                    const result = value as JoinReply;
                    if (
                        !result.success &&
                        (result.error === '接続が切れています' || result.error === '応答がタイムアウトしました')
                    ) {
                        if (ws.readyState < 2) ws.close();
                        return;
                    }
                    if (!result.success) {
                        this.joined = null;
                        joined.callback(result);
                        ws.close();
                        return;
                    }
                    this.connected = true;
                    this.id = result.userId;
                    this.attempts = 0;
                    joined.callback(result);
                    this.dispatch('connect');
                });
            };
            ws.onmessage = (event) => {
                if (generation !== this.generation) return;
                const frame = JSON.parse(String(event.data)) as Frame;
                if (frame.replyTo) {
                    const pending = this.pending.get(frame.replyTo);
                    if (pending) {
                        clearTimeout(pending.timer);
                        this.pending.delete(frame.replyTo);
                        pending.callback(frame.data);
                    }
                } else if (frame.event) {
                    if (frame.event === 'session:replaced' || frame.event === 'instance:closing') this.joined = null;
                    this.dispatch(frame.event, frame.data);
                }
            };
            ws.onclose = () => {
                clearTimeout(handshake);
                if (generation !== this.generation) return;
                this.connected = false;
                this.failPending();
                this.dispatch('disconnect');
                this.scheduleReconnect();
            };
            ws.onerror = () => {
                if (generation === this.generation)
                    this.dispatch('connect_error', new Error('インスタンスに接続できません'));
            };
        } catch (error) {
            if (generation !== this.generation) return;
            this.dispatch('connect_error', error instanceof Error ? error : new Error(String(error)));
            this.scheduleReconnect();
        }
    }
    private scheduleReconnect() {
        if (!this.joined) return;
        clearTimeout(this.retry);
        this.retry = setTimeout(() => void this.open(), Math.min(1000 * 2 ** this.attempts++, 10000));
    }
    private failPending() {
        const pending = [...this.pending.values()];
        this.pending.clear();
        for (const { callback, timer } of pending) {
            clearTimeout(timer);
            callback({ success: false, error: '接続が切れています', timeline: null });
        }
    }
    disconnect() {
        this.generation++;
        this.joined = null;
        clearTimeout(this.retry);
        this.ws?.close();
        this.ws = null;
        this.connected = false;
        this.failPending();
    }
}
