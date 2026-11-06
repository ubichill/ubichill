import type { ClientToServerEvents, InstanceAPI, InstanceFeature, ServerToClientEvents } from '@ubichill/shared';

type Events = ServerToClientEvents & {
    connect: () => void;
    disconnect: () => void;
    connecting: () => void;
    connect_error: (error: Error) => void;
};
type Listener = (...args: unknown[]) => void;
type Join = Parameters<ClientToServerEvents['world:join']>[0];
type JoinReply = Parameters<Parameters<ClientToServerEvents['world:join']>[1]>[0];
export type InstanceGrant = InstanceAPI['schemas']['InstanceGrant'];
export type ResolveInstance = (instanceId: string, password?: string, signal?: AbortSignal) => Promise<InstanceGrant>;
/** 認可・パスワード・プロトコル不一致による入室拒否。再試行しても変わらないので、自動再接続を止めて参加失敗として返す。 */
export class InstanceJoinRejected extends Error {}
interface Frame {
    event?: string;
    data?: unknown;
    id?: string;
    replyTo?: string;
}

/** 入室で宣言する受け取れる形。cursors:moved は受け取った所で cursor:moved に展開するので、上の層は変わらない。 */
const FEATURES: InstanceFeature[] = ['cursors:batch'];

// 最初の入室は早く諦めて利用者に知らせる。一度入れた後の切断（Pod の障害など）は、部屋のリースが切れて
// 別の Pod が作り直せるまで（TTL 30 秒 + backend の作り直し）待つ必要があるので長く続ける
const MAX_ATTEMPTS = 6;
const RECOVERY_TIMEOUT_MS = 30000;
const RECONNECT_MAX_ATTEMPTS = 10;
const RECONNECT_TIMEOUT_MS = 60000;
const STABLE_CONNECTION_MS = 10000;
// 部屋が別の Pod へ引っ越している間（数秒）、変更の要求は code: "migrating" で断られる。同じ要求を送り直す
const MIGRATING_RETRY_MS = 500;
const MIGRATING_RETRIES = 20;
const isMigrating = (value: unknown): boolean =>
    typeof value === 'object' && value !== null && (value as { code?: unknown }).code === 'migrating';
interface Recovery {
    attempts: number;
    maxAttempts: number;
    deadline: number;
    ticketRefreshes: number;
}

/** Typed instance transport. Disconnected operations are never replayed: a fresh
 * snapshot restores state after reconnect. Only joining is retried automatically. */
export class InstanceSocket {
    connected = false;
    connecting = false;
    id: string | undefined;
    private ws: WebSocket | null = null;
    private listeners = new Map<string, Set<Listener>>();
    private pending = new Map<string, { callback: Listener; timer: ReturnType<typeof setTimeout> }>();
    private joined: { data: Join; callback: (result: JoinReply) => void } | null = null;
    private retry: ReturnType<typeof setTimeout> | undefined;
    private generation = 0;
    private recovery: Recovery | null = null;
    /** 今の入室（joined）で一度でも入れたか。入れた後の切断は長い復旧の期限を使う */
    private joinedOnce = false;
    private deadlineTimer: ReturnType<typeof setTimeout> | undefined;
    private stableTimer: ReturnType<typeof setTimeout> | undefined;
    private attemptAbort: AbortController | null = null;

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
    private send(event: string, data: unknown, callback?: Listener, retries = 0) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            callback?.({ success: false, error: '接続が切れています' });
            return;
        }
        // A stale cursor/ephemeral update can be dropped before entering TCP's queue.
        if ((event === 'cursor:move' || event === 'entity:ephemeral') && this.ws.bufferedAmount > 65536) return;
        const id = callback ? crypto.randomUUID() : undefined;
        if (id && callback) {
            const settle = (value: unknown) => {
                if (event !== 'world:join' && retries < MIGRATING_RETRIES && isMigrating(value)) {
                    // 待つ間も pending に置く。切断・退出・別の部屋への入室で failPending が取り消し、古い部屋の要求を新しい接続へ送らない
                    const generation = this.generation;
                    const waitId = crypto.randomUUID();
                    const wait = setTimeout(() => {
                        this.pending.delete(waitId);
                        if (generation !== this.generation) {
                            callback({ success: false, error: '接続が切れています' });
                            return;
                        }
                        this.send(event, data, callback, retries + 1);
                    }, MIGRATING_RETRY_MS);
                    this.pending.set(waitId, { callback, timer: wait });
                    return;
                }
                callback(value);
            };
            const timer = setTimeout(() => {
                this.pending.delete(id);
                callback({ success: false, error: '応答がタイムアウトしました' });
            }, 10000);
            this.pending.set(id, { callback: settle, timer });
        }
        this.ws.send(JSON.stringify({ event, data, id }));
    }
    private async open() {
        if (!this.prepareRecovery()) return;
        const generation = ++this.generation;
        const joined = this.joined;
        const recovery = this.recovery;
        if (!joined || !recovery) return;
        recovery.attempts++;
        this.attemptAbort?.abort();
        const abort = new AbortController();
        this.attemptAbort = abort;
        try {
            const grant = await this.resolveInstance(joined.data.instanceId, joined.data.password, abort.signal);
            if (generation !== this.generation) return;
            if (grant.protocolVersion !== 1) throw new InstanceJoinRejected('非対応の通信バージョンです');
            const url = new URL(grant.url, window.location.href);
            url.protocol = url.protocol === 'https:' || url.protocol === 'wss:' ? 'wss:' : 'ws:';
            const ws = new WebSocket(url);
            this.ws = ws;
            // The bearer ticket travels in the first frame, never in a URL or cookie.
            const handshake = setTimeout(() => ws.close(), 10000);
            ws.onopen = () => {
                if (generation !== this.generation) return;
                const { instanceId, user } = joined.data;
                this.send('world:join', { instanceId, user, token: grant.token, features: FEATURES }, (value) => {
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
                        if (result.code === 'ticket_invalid' && recovery.ticketRefreshes < 1) {
                            recovery.ticketRefreshes++;
                            ws.close();
                        } else if (result.code === 'instance_unavailable') {
                            ws.close();
                        } else {
                            this.failJoin(result.error ?? 'インスタンスに参加できません');
                        }
                        return;
                    }
                    this.connected = true;
                    this.connecting = false;
                    this.joinedOnce = true;
                    this.id = result.userId;
                    clearTimeout(this.deadlineTimer);
                    // Brief successful joins must not reset an endlessly flapping connection.
                    this.stableTimer = setTimeout(() => {
                        if (generation === this.generation && this.connected) this.recovery = null;
                    }, STABLE_CONNECTION_MS);
                    joined.callback(result);
                    if (generation === this.generation && this.connected) this.dispatch('connect');
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
                } else if (frame.event === 'cursors:moved') {
                    if (!Array.isArray(frame.data)) return;
                    for (const cursor of frame.data) this.dispatch('cursor:moved', cursor);
                } else if (frame.event) {
                    if (frame.event === 'session:replaced' || frame.event === 'instance:closing') this.joined = null;
                    this.dispatch(frame.event, frame.data);
                }
            };
            ws.onclose = () => {
                clearTimeout(handshake);
                if (generation !== this.generation) return;
                clearTimeout(this.stableTimer);
                this.ws = null;
                this.connected = false;
                this.connecting = this.joined !== null;
                this.failPending();
                if (generation !== this.generation) return;
                this.dispatch('disconnect');
                this.scheduleReconnect();
            };
            ws.onerror = () => {
                if (generation === this.generation)
                    this.dispatch('connect_error', new Error('インスタンスに接続できません'));
            };
        } catch (error) {
            if (generation !== this.generation) return;
            if (error instanceof InstanceJoinRejected) {
                this.failJoin(error.message);
                return;
            }
            this.dispatch('connect_error', error instanceof Error ? error : new Error(String(error)));
            this.scheduleReconnect();
        }
    }
    private prepareRecovery(): boolean {
        if (!this.joined) return false;
        this.recovery ??= {
            attempts: 0,
            maxAttempts: this.joinedOnce ? RECONNECT_MAX_ATTEMPTS : MAX_ATTEMPTS,
            deadline: Date.now() + (this.joinedOnce ? RECONNECT_TIMEOUT_MS : RECOVERY_TIMEOUT_MS),
            ticketRefreshes: 0,
        };
        const remaining = this.recovery.deadline - Date.now();
        if (remaining <= 0 || this.recovery.attempts >= this.recovery.maxAttempts) {
            this.failJoin('インスタンスに接続できません。再試行の上限に達しました');
            return false;
        }
        clearTimeout(this.deadlineTimer);
        clearTimeout(this.stableTimer);
        this.deadlineTimer = setTimeout(() => this.failJoin('インスタンスへの接続がタイムアウトしました'), remaining);
        this.connecting = true;
        this.dispatch('connecting');
        return true;
    }
    private failJoin(message: string) {
        const joined = this.joined;
        if (!joined) return;
        this.disconnect();
        joined.callback({ success: false, error: message });
    }
    private scheduleReconnect() {
        if (!this.prepareRecovery()) return;
        clearTimeout(this.retry);
        const attempts = this.recovery?.attempts ?? 1;
        this.retry = setTimeout(() => void this.open(), Math.min(1000 * 2 ** Math.max(0, attempts - 1), 10000));
    }
    private failPending() {
        const pending = [...this.pending.values()];
        this.pending.clear();
        for (const { callback, timer } of pending) {
            clearTimeout(timer);
            callback({ success: false, error: '接続が切れています' });
        }
    }
    disconnect() {
        const wasActive = this.connected || this.connecting;
        this.generation++;
        this.joined = null;
        this.recovery = null;
        this.joinedOnce = false;
        clearTimeout(this.retry);
        clearTimeout(this.deadlineTimer);
        clearTimeout(this.stableTimer);
        this.attemptAbort?.abort();
        this.attemptAbort = null;
        this.ws?.close();
        this.ws = null;
        this.connected = false;
        this.connecting = false;
        this.id = undefined;
        this.failPending();
        if (wasActive) this.dispatch('disconnect');
    }
}
