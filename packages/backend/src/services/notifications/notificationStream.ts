import type { NotificationStreamEvent } from '@ubichill/shared';
import type { NotificationHub } from './notificationHub';

/** SSE の 1 つの出来事。`event:` は出来事の種類、`data:` は JSON（改行を含まない）。 */
export const sseFrame = (event: NotificationStreamEvent): string =>
    `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;

/** 応答の書き先（Express の Response を包む。テストでは配列に書く）。 */
export interface SseSink {
    write(chunk: string): void;
    end(): void;
    onClose(listener: () => void): void;
}

export interface Timers {
    setInterval(fn: () => void, ms: number): unknown;
    clearInterval(handle: unknown): void;
    setTimeout(fn: () => void, ms: number): unknown;
    clearTimeout(handle: unknown): void;
}

const realTimers: Timers = {
    setInterval: (fn, ms) => setInterval(fn, ms).unref(),
    clearInterval: (h) => clearInterval(h as NodeJS.Timeout),
    setTimeout: (fn, ms) => setTimeout(fn, ms).unref(),
    clearTimeout: (h) => clearTimeout(h as NodeJS.Timeout),
};

export const STREAM_DEFAULTS = {
    /** Cloudflare（Tunnel を含む）は 100 秒何も流れない接続を切るので、それより十分短く */
    keepAliveMs: 25_000,
    /**
     * 1 本の接続を開いておく上限。ログアウト・セッションの失効を接続し直し（認証し直し）で反映するため。
     * EventSource は閉じられると retry の間隔で繋ぎ直し、クライアントは繋ぎ直すたびに一覧を取り直す。
     */
    maxLifetimeMs: 15 * 60_000,
    retryMs: 5_000,
} as const;

/**
 * 利用者の SSE を開く。届いた出来事を書き、keep-alive のコメントを流し、上限の時間で閉じる。
 * 接続が切れたら hub から外す（切れたあとの出来事は書かない。クライアントは繋ぎ直して一覧を取り直す）。
 */
export function openNotificationStream(deps: {
    userId: string;
    sink: SseSink;
    hub: Pick<NotificationHub, 'connect'>;
    timers?: Timers;
    keepAliveMs?: number;
    maxLifetimeMs?: number;
    retryMs?: number;
}): { close(): void } {
    const timers = deps.timers ?? realTimers;
    const state = { open: true };
    const handles: { keepAlive?: unknown; lifetime?: unknown; disconnect?: () => void } = {};

    const close = (): void => {
        if (!state.open) return;
        state.open = false;
        timers.clearInterval(handles.keepAlive);
        timers.clearTimeout(handles.lifetime);
        handles.disconnect?.();
        deps.sink.end();
    };
    const write = (chunk: string): void => {
        if (state.open) deps.sink.write(chunk);
    };

    write(`retry: ${deps.retryMs ?? STREAM_DEFAULTS.retryMs}\n: connected\n\n`);
    handles.disconnect = deps.hub.connect(deps.userId, { send: (event) => write(sseFrame(event)), close });
    handles.keepAlive = timers.setInterval(
        () => write(': keep-alive\n\n'),
        deps.keepAliveMs ?? STREAM_DEFAULTS.keepAliveMs,
    );
    handles.lifetime = timers.setTimeout(close, deps.maxLifetimeMs ?? STREAM_DEFAULTS.maxLifetimeMs);
    deps.sink.onClose(close);
    return { close };
}
