/**
 * dev サーバーが子プロセスで起動する Go のインスタンスサーバー。127.0.0.1 の空きポートで `--guests` で動かし、
 * 管理 API（部屋の作成・削除）は起動ごとに作る乱数のトークンで呼ぶ。終了するときは自分が起動した PID だけを止める。
 */
import { type ChildProcess, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import type { InstanceDefinition } from '@ubichill/shared';

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
    log?: (line: string) => void;
    fetchImpl?: typeof fetch;
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

export async function startGo(options: StartGoOptions): Promise<GoRuntime> {
    const port = await freePort();
    const token = randomBytes(32).toString('hex');
    const base = `http://127.0.0.1:${port}`;
    const fetchImpl = options.fetchImpl ?? fetch;
    if (options.signal?.aborted) throw new Error('Go のインスタンスサーバーの起動を中止しました');
    const child = spawn(
        options.binary,
        ['--guests', `--listen=127.0.0.1:${port}`, `--origins=${options.origins.join(',')}`],
        { env: { ...process.env, INSTANCE_ADMIN_TOKEN: token }, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const log = options.log ?? ((line) => console.log(line));
    for (const stream of [child.stdout, child.stderr]) {
        stream?.on('data', (chunk: Buffer) => {
            for (const line of chunk.toString().split('\n')) if (line.trim()) log(`[instance] ${line}`);
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
}

export function superviseGo(
    options: Omit<StartGoOptions, 'onExit' | 'signal'> & {
        /** 起動し直して動き出したとき（部屋を作り直す）。 */
        onRestarted?: () => void;
    },
): GoSupervisor {
    const controller = new AbortController();
    const log = options.log ?? ((line) => console.log(line));
    const state = { current: undefined as GoRuntime | undefined, starting: null as Promise<void> | null };

    const launch = (): Promise<void> => {
        const starting = startGo({
            ...options,
            signal: controller.signal,
            onExit: (code) => {
                state.current = undefined;
                if (controller.signal.aborted) return;
                log(`⚠️  Go のインスタンスサーバーが終了しました (exit ${code})。起動し直します`);
                launch()
                    .then(() => options.onRestarted?.())
                    .catch((error: unknown) => {
                        if (!controller.signal.aborted)
                            log(
                                `❌ Go のインスタンスサーバーを起動し直せません: ${error instanceof Error ? error.message : error}`,
                            );
                    });
            },
        }).then((runtime) => {
            state.current = runtime;
        });
        const tracked: Promise<void> = starting.finally(() => {
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
    };
}
