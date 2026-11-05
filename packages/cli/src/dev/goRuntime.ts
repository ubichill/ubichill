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
    stop(): void;
}

export interface StartGoOptions {
    binary: string;
    /** ブラウザのオリジン（Go の Origin 検査に通す）。 */
    origins: readonly string[];
    /** 落ちたときに呼ぶ（意図した停止では呼ばない）。 */
    onExit?: (code: number | null) => void;
    log?: (line: string) => void;
    fetchImpl?: typeof fetch;
}

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

async function waitForHealth(base: string, child: ChildProcess, fetchImpl: typeof fetch): Promise<void> {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
        if (child.exitCode !== null)
            throw new Error(`Go のインスタンスサーバーが起動直後に終了しました (exit ${child.exitCode})`);
        const response = await fetchImpl(`${base}/health`).catch(() => null);
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
    const state = { stopping: false };
    child.on('exit', (code) => {
        if (!state.stopping) options.onExit?.(code);
    });
    await waitForHealth(base, child, fetchImpl);
    return {
        port,
        ...createGoAdmin(base, token, fetchImpl),
        stop() {
            state.stopping = true;
            if (child.exitCode === null) child.kill();
        },
    };
}
