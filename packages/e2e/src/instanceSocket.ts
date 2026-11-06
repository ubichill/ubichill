import { randomUUID } from 'node:crypto';
import { isRecord, preview } from './http.ts';

/** インスタンスサーバーの WebSocket のフレーム。要求は id を付け、応答は replyTo で返る。 */
export interface Frame {
    readonly event?: string;
    readonly data?: unknown;
    readonly id?: string;
    readonly replyTo?: string;
}

export interface InstanceSocket {
    /** 応答を待つ要求（world:join・state:update など） */
    readonly request: (event: string, data: unknown, timeoutMs?: number) => Promise<unknown>;
    /** 応答の無い送信（cursor:move など） */
    readonly send: (event: string, data: unknown) => void;
    /** 受け取った（これから受け取る）イベントのうち、条件に合う最初のもの。接続してからの分はすべて見る */
    readonly waitFor: (event: string, match?: (data: unknown) => boolean, timeoutMs?: number) => Promise<unknown>;
    readonly close: () => void;
}

export function parseFrame(raw: unknown): Frame | null {
    if (typeof raw !== 'string') return null;
    try {
        const value: unknown = JSON.parse(raw);
        if (!isRecord(value)) return null;
        return {
            event: typeof value.event === 'string' ? value.event : undefined,
            data: value.data,
            id: typeof value.id === 'string' ? value.id : undefined,
            replyTo: typeof value.replyTo === 'string' ? value.replyTo : undefined,
        };
    } catch {
        return null;
    }
}

interface Waiter {
    readonly accepts: (frame: Frame) => boolean;
    readonly resolve: (data: unknown) => void;
}

export function connectInstance(url: string, timeoutMs = 10_000): Promise<InstanceSocket> {
    const socket = new WebSocket(url);
    const received: Frame[] = [];
    const waiters = new Set<Waiter>();
    const closed = { reason: '' };

    socket.addEventListener('message', (event) => {
        const frame = parseFrame(event.data);
        if (!frame) return;
        received.push(frame);
        for (const waiter of waiters) {
            if (waiter.accepts(frame)) {
                waiters.delete(waiter);
                waiter.resolve(frame.data);
            }
        }
    });

    const wait = (accepts: (frame: Frame) => boolean, ms: number, what: string): Promise<unknown> => {
        const found = received.find(accepts);
        if (found) return Promise.resolve(found.data);
        const pending = new Promise<unknown>((resolve, reject) => {
            const waiter: Waiter = {
                accepts,
                resolve: (data) => {
                    clearTimeout(timer);
                    resolve(data);
                },
            };
            const timer = setTimeout(() => {
                waiters.delete(waiter);
                const suffix = closed.reason ? `（接続は閉じています: ${closed.reason}）` : '';
                reject(new Error(`${what} が ${ms}ms 以内に届きませんでした${suffix}`));
            }, ms);
            waiters.add(waiter);
        });
        // 先に待ち始めて、前の操作が落ちたときは待たれないまま期限が来る。未処理の reject で落ちないようにする
        pending.catch(() => {});
        return pending;
    };

    const instance: InstanceSocket = {
        request: (event, data, ms = timeoutMs) => {
            const id = randomUUID();
            socket.send(JSON.stringify({ event, id, data }));
            return wait((frame) => frame.replyTo === id, ms, `${event} の応答`);
        },
        send: (event, data) => socket.send(JSON.stringify({ event, data })),
        waitFor: (event, match = () => true, ms = timeoutMs) =>
            wait((frame) => frame.event === event && match(frame.data), ms, event),
        close: () => socket.close(),
    };

    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            socket.close();
            reject(new Error(`WebSocket（${url}）に ${timeoutMs}ms 以内に繋がりませんでした`));
        }, timeoutMs);
        socket.addEventListener('open', () => {
            clearTimeout(timer);
            resolve(instance);
        });
        socket.addEventListener('error', () => {
            clearTimeout(timer);
            reject(new Error(`WebSocket（${url}）に繋がりませんでした`));
        });
        socket.addEventListener('close', (event) => {
            closed.reason = `${event.code} ${event.reason}`.trim();
        });
    });
}

/** world:join などの応答が成功か。失敗なら理由を含めて投げる。 */
export function expectSuccess(reply: unknown, what: string): Record<string, unknown> {
    if (!isRecord(reply) || reply.success !== true) throw new Error(`${what} が失敗しました: ${preview(reply)}`);
    return reply;
}
