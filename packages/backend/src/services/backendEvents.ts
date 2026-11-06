import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { RedisCommands } from '../lib/redis';
import { type OutageLog, redisOutage } from '../lib/redisOutage';

/**
 * ほかの backend のプロセス内キャッシュを捨てさせる知らせ。送った側は自分の状態をもう変えてある。
 * 届かなくても各キャッシュの TTL で揃う（知らせは速く揃えるためのもの）。
 */
const BackendEventSchema = z.discriminatedUnion('type', [
    /** 本体のワールドを保存・削除した（解決結果を捨てる）。 */
    z.object({ type: z.literal('world.changed'), worldId: z.string().min(1) }),
    /** リポジトリのワールドを 1 つ読み直す。 */
    z.object({ type: z.literal('world.reload'), worldId: z.string().min(1) }),
    /** リポジトリのワールドを全部読み直す。 */
    z.object({ type: z.literal('worlds.reload') }),
    /** 作者の鍵・表示名が変わった（解決済みのワールドを全部捨てる）。 */
    z.object({ type: z.literal('worlds.resolved-stale') }),
    /** 外部の URL の中身が変わったかもしれない（取得結果・確認結果を捨てる）。 */
    z.object({ type: z.literal('remote.changed'), url: z.string().min(1) }),
    /** 連合のフォローが変わった（DB から読み直す）。 */
    z.object({ type: z.literal('peers.changed') }),
    /** 公開のお気に入りが変わった。 */
    z.object({ type: z.literal('favorites.changed'), userId: z.string().min(1) }),
]);

export type BackendEvent = z.infer<typeof BackendEventSchema>;
type EventType = BackendEvent['type'];
type Handler<T extends EventType> = (event: Extract<BackendEvent, { type: T }>) => void | Promise<void>;

/** backend の間で知らせを運ぶ口。自分が送ったものは自分には届けない。 */
export interface BackendBus {
    publish(event: BackendEvent): Promise<void>;
    subscribe(handler: (event: BackendEvent) => void): Promise<void>;
    close(): Promise<void>;
}

const newOrigin = (): string => randomBytes(8).toString('hex');

/** 1 プロセスの中の backend 同士（テスト用。Redis なしの本番では何もつながないので、何も届かない）。 */
export function createMemoryBusHub(): { connect(): BackendBus } {
    const members = new Set<{ origin: string; handlers: Set<(event: BackendEvent) => void> }>();
    return {
        connect: () => {
            const self = { origin: newOrigin(), handlers: new Set<(event: BackendEvent) => void>() };
            members.add(self);
            return {
                publish: async (event) => {
                    const copy = BackendEventSchema.parse(JSON.parse(JSON.stringify(event)));
                    for (const member of members) {
                        if (member === self) continue;
                        for (const handler of member.handlers) queueMicrotask(() => handler(copy));
                    }
                },
                subscribe: async (handler) => {
                    self.handlers.add(handler);
                },
                close: async () => {
                    members.delete(self);
                },
            };
        },
    };
}

/** Pub/Sub の購読に使う接続（node-redis では `duplicate()` した別の接続。購読中の接続はほかの命令を送れない）。 */
export interface RedisSubscriber {
    subscribe(channel: string, listener: (message: string) => void): Promise<unknown>;
    unsubscribe(channel: string): Promise<unknown>;
}

export const BACKEND_CHANNEL = 'ubi:ch:backend';

/** Redis の Pub/Sub で運ぶ。送れなかった知らせは捨てる（TTL で揃う）。 */
export function createRedisBackendBus(deps: {
    publisher: RedisCommands;
    subscriber: RedisSubscriber;
    log: OutageLog;
    channel?: string;
}): BackendBus {
    const channel = deps.channel ?? BACKEND_CHANNEL;
    const origin = newOrigin();
    const handlers = new Set<(event: BackendEvent) => void>();
    const outage = redisOutage('キャッシュの無効化の知らせ', '送らずに TTL で揃えます', deps.log);
    const state = { subscribed: false };
    const listener = (message: string): void => {
        const parsed = (() => {
            try {
                return z.object({ origin: z.string(), event: BackendEventSchema }).safeParse(JSON.parse(message));
            } catch {
                return undefined;
            }
        })();
        if (!parsed?.success) {
            deps.log.warn(`${channel} の知らせを読めません（捨てます）`);
            return;
        }
        if (parsed.data.origin === origin) return;
        for (const handler of handlers) handler(parsed.data.event);
    };
    return {
        publish: async (event) => {
            try {
                await deps.publisher.sendCommand(['PUBLISH', channel, JSON.stringify({ origin, event })]);
                outage.succeeded();
            } catch (err) {
                outage.failed(err);
            }
        },
        subscribe: async (handler) => {
            handlers.add(handler);
            if (state.subscribed) return;
            state.subscribed = true;
            await deps.subscriber.subscribe(channel, listener);
        },
        close: async () => {
            handlers.clear();
            if (state.subscribed) await deps.subscriber.unsubscribe(channel).catch(() => undefined);
            state.subscribed = false;
        },
    };
}

/**
 * プロセスの中の各モジュールが知らせを送る・受ける窓口。運ぶ口（{@link BackendBus}）は起動時に付ける。
 * 付けていなければ（Redis なし・テスト）送っても何もしない。
 */
export function createBackendEvents(log: Pick<OutageLog, 'warn'> = console) {
    const handlers = new Map<EventType, Set<(event: BackendEvent) => void | Promise<void>>>();
    const state: { bus: BackendBus | null } = { bus: null };
    const dispatch = (event: BackendEvent): void => {
        for (const handler of handlers.get(event.type) ?? []) {
            Promise.resolve()
                .then(() => handler(event))
                .catch((err: unknown) => log.warn(`知らせ ${event.type} の処理に失敗しました（TTL で揃えます）:`, err));
        }
    };
    return {
        /** ほかの backend に知らせる。自分の状態は呼ぶ前に変えておくこと。 */
        broadcast: (event: BackendEvent): void => {
            void state.bus?.publish(event);
        },
        on: <T extends EventType>(type: T, handler: Handler<T>): void => {
            const set = handlers.get(type) ?? new Set();
            set.add((event) => handler(event as Extract<BackendEvent, { type: T }>));
            handlers.set(type, set);
        },
        attach: async (bus: BackendBus): Promise<void> => {
            state.bus = bus;
            await bus.subscribe(dispatch);
        },
        detach: async (): Promise<void> => {
            const bus = state.bus;
            state.bus = null;
            await bus?.close();
        },
    };
}

export type BackendEvents = ReturnType<typeof createBackendEvents>;

export const backendEvents: BackendEvents = createBackendEvents();
