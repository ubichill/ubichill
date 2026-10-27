import { type NotificationStreamEvent, NotificationStreamEventSchema } from '@ubichill/shared';
import { z } from 'zod';
import type { RedisCommands } from '../lib/redis';
import { type OutageLog, redisOutage } from '../lib/redisOutage';
import type { RedisSubscriber } from './backendEvents';

/** 全員（運営のお知らせ）に届ける宛先。ユーザー ID とは重ならない（ユーザー ID は `*` を含まない）。 */
export const EVERYONE = '*';

const DeliverySchema = z.object({ to: z.string().min(1), event: NotificationStreamEventSchema });
export type Delivery = z.infer<typeof DeliverySchema>;

/**
 * backend の全台へ通知の配送を運ぶ口。backendEvents（キャッシュの無効化）と違い、**送った台にも届く**
 * （SSE の接続はどの台にもあり得るので、送った台の利用者にも同じ道で届ける）。
 */
export interface NotificationBus {
    publish(delivery: Delivery): Promise<void>;
    subscribe(handler: (delivery: Delivery) => void): Promise<void>;
    close(): Promise<void>;
}

/** 1 プロセスの中の複数の backend（テスト用）。 */
export function createMemoryNotificationBusHub(): { connect(): NotificationBus } {
    const members = new Set<Set<(delivery: Delivery) => void>>();
    return {
        connect: () => {
            const handlers = new Set<(delivery: Delivery) => void>();
            members.add(handlers);
            return {
                publish: async (delivery) => {
                    const copy = DeliverySchema.parse(JSON.parse(JSON.stringify(delivery)));
                    for (const member of members) {
                        for (const handler of member) queueMicrotask(() => handler(copy));
                    }
                },
                subscribe: async (handler) => {
                    handlers.add(handler);
                },
                close: async () => {
                    handlers.clear();
                    members.delete(handlers);
                },
            };
        },
    };
}

export const NOTIFICATION_CHANNEL = 'ubi:ch:notifications';

/** Redis の Pub/Sub で運ぶ。Redis は購読している接続に、送った台かどうかを問わず届ける。 */
export function createRedisNotificationBus(deps: {
    publisher: RedisCommands;
    subscriber: RedisSubscriber;
    log: OutageLog;
    channel?: string;
}): NotificationBus {
    const channel = deps.channel ?? NOTIFICATION_CHANNEL;
    const handlers = new Set<(delivery: Delivery) => void>();
    const outage = redisOutage(
        '通知の配送',
        'この台に繋いだ人にだけ届けます（ほかの人は一覧の取り直しで追いつきます）',
        deps.log,
    );
    const state = { subscribed: false };
    const listener = (message: string): void => {
        const parsed = (() => {
            try {
                return DeliverySchema.safeParse(JSON.parse(message));
            } catch {
                return undefined;
            }
        })();
        if (!parsed?.success) {
            deps.log.warn(`${channel} の配送を読めません（捨てます）`);
            return;
        }
        for (const handler of handlers) handler(parsed.data);
    };
    return {
        publish: async (delivery) => {
            try {
                await deps.publisher.sendCommand(['PUBLISH', channel, JSON.stringify(delivery)]);
                outage.succeeded();
            } catch (err) {
                outage.failed(err);
                throw err;
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

/** この台に繋いでいる SSE の 1 本。 */
export interface StreamConnection {
    send(event: NotificationStreamEvent): void;
    /** 上限を超えて追い出すとき（いちばん古い接続から） */
    close(): void;
}

/**
 * 通知を届ける窓口。この台の SSE の接続を利用者ごとに持ち、配送は bus（全台）に任せる。
 * bus が無い（Redis なし）か送れなかったときは、この台の接続にだけ届ける（ほかの台の人は一覧の取り直しで追いつく）。
 */
export function createNotificationHub(options: { maxConnectionsPerUser: number; log?: Pick<OutageLog, 'warn'> }) {
    const connections = new Map<string, StreamConnection[]>();
    const state: { bus: NotificationBus | null } = { bus: null };
    const log = options.log ?? console;

    const dispatch = ({ to, event }: Delivery): void => {
        const targets = to === EVERYONE ? [...connections.values()].flat() : (connections.get(to) ?? []);
        for (const connection of targets) {
            try {
                connection.send(event);
            } catch (err) {
                log.warn('通知を SSE に書けませんでした:', err);
            }
        }
    };

    const remove = (userId: string, connection: StreamConnection): void => {
        const rest = (connections.get(userId) ?? []).filter((c) => c !== connection);
        if (rest.length === 0) connections.delete(userId);
        else connections.set(userId, rest);
    };

    return {
        /** 接続を足す。上限を超えたら古い接続を閉じる。戻り値で外す。 */
        connect(userId: string, connection: StreamConnection): () => void {
            const list = [...(connections.get(userId) ?? []), connection];
            const evicted = list.slice(0, Math.max(0, list.length - options.maxConnectionsPerUser));
            connections.set(userId, list.slice(evicted.length));
            for (const old of evicted) old.close();
            return () => remove(userId, connection);
        },
        async deliver(to: string, event: NotificationStreamEvent): Promise<void> {
            const bus = state.bus;
            if (!bus) {
                dispatch({ to, event });
                return;
            }
            try {
                await bus.publish({ to, event });
            } catch {
                dispatch({ to, event });
            }
        },
        connectionCount(userId?: string): number {
            return userId === undefined
                ? [...connections.values()].reduce((n, list) => n + list.length, 0)
                : (connections.get(userId)?.length ?? 0);
        },
        /** この台の SSE を全部閉じる（停止時。開いたままだと HTTP サーバーが止まらない）。クライアントはほかの台へ繋ぎ直す。 */
        closeAll(): void {
            const all = [...connections.values()].flat();
            connections.clear();
            for (const connection of all) connection.close();
        },
        async attach(bus: NotificationBus): Promise<void> {
            await bus.subscribe(dispatch);
            state.bus = bus;
        },
        async detach(): Promise<void> {
            const bus = state.bus;
            state.bus = null;
            await bus?.close();
        },
    };
}

export type NotificationHub = ReturnType<typeof createNotificationHub>;

export const notificationHub: NotificationHub = createNotificationHub({ maxConnectionsPerUser: 5 });
