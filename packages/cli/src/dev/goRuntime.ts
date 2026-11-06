/**
 * dev サーバーが子プロセスで起動する Go のインスタンスサーバー。127.0.0.1 の空きポートで `--guests` で動かし、
 * 管理 API（部屋の作成・削除）は起動ごとに作る乱数のトークンで呼ぶ。終了するときは自分が起動した PID だけを止める。
 * Go のログ（JSON の行）は goLog.ts で `[instance]` の行にする。
 */
import { type ChildProcess, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { performance } from 'node:perf_hooks';
import { createInterface } from 'node:readline';
import type { Readable } from 'node:stream';
import type { InstanceDefinition } from '@ubichill/shared';
import { formatDuration, type Logger, silentLogger } from '@ubichill/terminal';
import { goArgs, parseGoLogLine, reportGoLine, shouldShowGoLine } from './goLog.ts';

export interface GoAdmin {
    /** 部屋を作る。Go が拒否したら ok: false と理由。 */
    putInstance(definition: InstanceDefinition): Promise<{ ok: true } | { ok: false; status: number; error: string }>;
    deleteInstance(instanceId: string): Promise<void>;
}

export interface GoRuntime extends GoAdmin {
    port: number;
    /** 止める。プロセスが終わるまで待つ。 */
    stop(): Promise<void>;
}

export interface StartGoOptions {
    binary: string;
    /** ブラウザのオリジン（Go の Origin 検査に通す）。 */
    origins: readonly string[];
    /** 落ちたときに呼ぶ（意図した停止では呼ばない）。 */
    onExit?: (code: number | null) => void;
    /** 中止したら、起動の途中でも子プロセスを止めて（終わるまで待って）reject する。 */
    signal?: AbortSignal;
    /** `[instance]` の行を出す先。 */
    log?: Logger;
    /** Go の info・debug のログも出す。 */
    debug?: boolean;
    fetchImpl?: typeof fetch;
    /** 子プロセスを作った直後に呼ぶ（起動の途中のものも、node が落ちるときに止められるように）。 */
    onSpawn?: (child: ChildProcess) => void;
}

/** 止めるときに SIGTERM で終わるのを待つ時間。過ぎたら SIGKILL。 */
export const STOP_TIMEOUT_MS = 5000;

/** 127.0.0.1 の空きポート。 */
export function freePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const server = createServer();
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            const port = typeof address === 'object' && address ? address.port : 0;
            server.close(() => resolve(port));
        });
    });
}

/** Go の管理 API の呼び出し（起動は別）。テストでは偽の Go を指す。 */
export function createGoAdmin(base: string, token: string, fetchImpl: typeof fetch = fetch): GoAdmin {
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
    return {
        async putInstance(definition) {
            const response = await fetchImpl(`${base}/realtime/v1/instances/${encodeURIComponent(definition.id)}`, {
                method: 'PUT',
                headers,
                body: JSON.stringify(definition),
            });
            if (response.ok) return { ok: true };
            const body = (await response.json().catch(() => ({}))) as { error?: string };
            return { ok: false, status: response.status, error: body.error ?? `HTTP ${response.status}` };
        },
        async deleteInstance(instanceId) {
            await fetchImpl(`${base}/realtime/v1/instances/${encodeURIComponent(instanceId)}`, {
                method: 'DELETE',
                headers,
            }).catch(() => undefined);
        },
    };
}

async function waitForHealth(
    base: string,
    child: ChildProcess,
    fetchImpl: typeof fetch,
    signal: AbortSignal | undefined,
): Promise<void> {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
        if (signal?.aborted) throw new Error('Go のインスタンスサーバーの起動を中止しました');
        if (child.exitCode !== null)
            throw new Error(`Go のインスタンスサーバーが起動直後に終了しました (exit ${child.exitCode})`);
        const response = await fetchImpl(`${base}/health`, { signal }).catch(() => null);
        if (response?.ok) return;
        await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('Go のインスタンスサーバーが 15 秒以内に起動しませんでした');
}

/** 子プロセスの出力を行ごとに読む（チャンクの境目で JSON の行や UTF-8 の文字が切れても 1 行にまとまる）。 */
function forEachLine(stream: Readable | null, onLine: (line: string) => void): void {
    if (stream) createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY }).on('line', onLine);
}

export async function startGo(options: StartGoOptions): Promise<GoRuntime> {
    const started = performance.now();
    const port = await freePort();
    const token = randomBytes(32).toString('hex');
    const base = `http://127.0.0.1:${port}`;
    const fetchImpl = options.fetchImpl ?? fetch;
    if (options.signal?.aborted) throw new Error('Go のインスタンスサーバーの起動を中止しました');
    const debug = options.debug ?? false;
    const args = goArgs({ port, origins: options.origins, debug });
    const log = options.log ?? silentLogger;
    log.debug(`Go を起動します: ${options.binary}`, args.join(' '));
    const child = spawn(options.binary, args, {
        env: { ...process.env, INSTANCE_ADMIN_TOKEN: token },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    options.onSpawn?.(child);
    for (const stream of [child.stdout, child.stderr]) {
        forEachLine(stream, (text) => {
            const line = parseGoLogLine(text);
            if (line && shouldShowGoLine(line, debug)) reportGoLine(line, log);
        });
    }
    const exited = new Promise<void>((resolve) => {
        if (child.exitCode !== null) resolve();
        else child.once('exit', () => resolve());
    });
    const state = { stopping: false };
    child.on('exit', (code) => {
        if (!state.stopping) options.onExit?.(code);
    });
    const stop = async () => {
        state.stopping = true;
        if (child.exitCode !== null || child.signalCode !== null) return;
        child.kill();
        // SIGTERM で終わらなければ（固まっている）強制的に止める
        const forced = setTimeout(() => child.kill('SIGKILL'), STOP_TIMEOUT_MS);
        await exited;
        clearTimeout(forced);
    };
    try {
        await waitForHealth(base, child, fetchImpl, options.signal);
    } catch (error) {
        await stop();
        throw error;
    }
    log.debug(`Go が応答しました: ${base}`, `pid ${child.pid}  ${formatDuration(performance.now() - started)}`);
    return { port, ...createGoAdmin(base, token, fetchImpl), stop };
}

/**
 * Go を起動し、落ちたら起動し直す。止めるときは、起動の途中の子プロセスも含めて止め、終わるまで待つ。
 * 起動し直しに失敗したら（起動直後に落ちる・応答しない）、それ以上は繰り返さない（同じ失敗を回し続けない）。
 */
export interface GoSupervisor {
    /** 動いている Go。起動し直している間は undefined。 */
    readonly current: GoRuntime | undefined;
    start(): Promise<void>;
    stop(): Promise<void>;
    /**
     * 今ある子プロセス（起動の途中のものも）にすぐ SIGKILL を送る。待たない。
     * node が落ちるとき（`process.on('exit')`。捕まらない例外でも呼ばれる）の最後の砦で、ふだんは stop を使う。
     */
    killNow(): void;
}

export function superviseGo(
    options: Omit<StartGoOptions, 'onExit' | 'signal'> & {
        /** 起動し直して動き出したとき（部屋を作り直す）。 */
        onRestarted?: () => void;
    },
): GoSupervisor {
    const controller = new AbortController();
    const log = options.log ?? silentLogger;
    const children = new Set<ChildProcess>();
    const track = (child: ChildProcess) => {
        children.add(child);
        child.once('exit', () => children.delete(child));
    };
    const state = { current: undefined as GoRuntime | undefined, starting: null as Promise<void> | null };

    const launch = (): Promise<void> => {
        const starting = startGo({
            ...options,
            signal: controller.signal,
            onSpawn: track,
            onExit: (code) => {
                state.current = undefined;
                if (controller.signal.aborted) return;
                log.warn(`Go のインスタンスサーバーが終了しました (exit ${code})。起動し直します`);
                launch()
                    .then(() => {
                        log.success('Go のインスタンスサーバーを起動し直しました');
                        options.onRestarted?.();
                    })
                    .catch((error: unknown) => {
                        if (!controller.signal.aborted)
                            log.error(
                                `Go のインスタンスサーバーを起動し直せません: ${error instanceof Error ? error.message : error}`,
                            );
                    });
            },
        }).then((runtime) => {
            state.current = runtime;
        });
        // stop が待つのは終わることだけ。失敗は start の呼び出し側に返す（起動し直しで置き換わった前の起動の失敗を、
        // 誰も受け取らない Promise に残さない）
        const tracked: Promise<void> = starting
            .catch(() => undefined)
            .finally(() => {
                if (state.starting === tracked) state.starting = null;
            });
        state.starting = tracked;
        return starting;
    };

    return {
        get current() {
            return state.current;
        },
        start: launch,
        async stop() {
            controller.abort();
            // 起動の途中なら startGo が子プロセスを止めて reject する。それを待ってから、動いているものを止める
            await state.starting?.catch(() => undefined);
            await state.current?.stop();
            state.current = undefined;
        },
        killNow() {
            controller.abort(); // 起動し直さない
            for (const child of children) child.kill('SIGKILL');
        },
    };
}
