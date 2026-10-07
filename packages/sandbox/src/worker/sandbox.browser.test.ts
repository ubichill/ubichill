/**
 * 本物の Sandbox Worker を本物の Chrome で動かし、封鎖と WASM・バイナリの受け渡しを確かめる。
 *
 * fetch がプロトタイプ側に残っていた抜け道は、Node の偽の self では再現できず実ブラウザでしか見つからなかった。
 * そのため Worker スクリプトを esbuild で束ね、本番と同じ CSP ヘッダーで配信し、最小の Host ページから起動する。
 * 依存を増やさないよう、Chrome とは Node 組み込みの WebSocket で DevTools Protocol を直接話す。
 * Chrome が見つからない環境（CHROME_PATH 未設定かつ既定の場所に無い）ではスキップする。
 */
import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isSandboxWorkerScriptPath, SANDBOX_WORKER_CSP } from '@ubichill/shared';
import * as esbuild from 'esbuild';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const packagesDir = fileURLToPath(new URL('../../../', import.meta.url));
const WORKER_PATH = '/assets/sandbox.worker-browsertest.js';

function findChrome(): string | undefined {
    const candidates = [
        process.env.CHROME_PATH,
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
    ];
    return candidates.find((path): path is string => !!path && existsSync(path));
}

const chromePath = findChrome();

/** sandbox.worker.ts をワークスペースのソースから 1 ファイルに束ねる（dist の古さに左右されないように）。 */
async function bundleSandboxWorker(): Promise<string> {
    const sources: Record<string, string> = {
        '@ubichill/sdk': 'sdk/src/index.ts',
        '@ubichill/shared': 'shared/src/index.ts',
        '@ubichill/ecs': 'ecs/src/index.ts',
        '@ubichill/runtime': 'runtime/src/index.ts',
        '@ubichill/core-components': 'core-components/src/index.ts',
        '@ubichill/core-components/public': 'core-components/src/public.ts',
    };
    const result = await esbuild.build({
        entryPoints: [join(packagesDir, 'sandbox/src/worker/sandbox.worker.ts')],
        bundle: true,
        format: 'esm',
        platform: 'browser',
        target: 'es2022',
        write: false,
        logLevel: 'silent',
        plugins: [
            {
                name: 'workspace-sources',
                setup(build) {
                    build.onResolve({ filter: /^@ubichill\// }, (args) => {
                        const exact = sources[args.path];
                        if (exact) return { path: join(packagesDir, exact) };
                        const sharedSub = /^@ubichill\/shared\/(.+)$/.exec(args.path);
                        return sharedSub ? { path: join(packagesDir, `shared/src/${sharedSub[1]}.ts`) } : undefined;
                    });
                },
            },
        ],
    });
    return result.outputFiles[0]?.text ?? '';
}

/** 最小の Host。Worker のコマンドに応答し、結果を window.__result に集める。 */
const HOST_PAGE = `<!doctype html><meta charset="utf-8"><script type="module">
const results = { probes: null, aborted: null, fetchOptions: null, hostBufferDetached: null, initFailed: null };
const worker = new Worker('${WORKER_PATH}', { type: 'module' });
const respond = (id, data, transfer = []) =>
    worker.postMessage({ type: 'EVT_RPC_RESPONSE', id, success: true, data }, transfer);
worker.onmessage = async ({ data: cmd }) => {
    switch (cmd.type) {
        case 'CMD_INIT_FAILED':
            results.initFailed = cmd.payload.error;
            window.__done = true;
            break;
        case 'ASSET_LOAD': {
            const bytes = await (await fetch('/wasm/' + cmd.payload.path)).arrayBuffer();
            respond(cmd.id, bytes, [bytes]);
            break;
        }
        case 'NETWORK_FETCH': {
            if (cmd.payload.url.includes('slow')) break;
            results.fetchOptions = cmd.payload.options;
            const body = new Uint8Array([0, 255, 1, 254]).buffer;
            respond(cmd.id, { ok: true, status: 200, statusText: 'OK', headers: {}, body }, [body]);
            results.hostBufferDetached = body.byteLength === 0;
            break;
        }
        case 'CMD_ABORT':
            results.aborted = cmd.payload.requestId;
            break;
        case 'NETWORK_SEND_TO_HOST':
            results[cmd.payload.type] = cmd.payload.data;
            if (cmd.payload.type === 'probes') window.__done = true;
            break;
    }
};
worker.postMessage({ type: 'EVT_LIFECYCLE_INIT', payload: { protocolVersion: 4, worldId: 'w', myUserId: 'u', modId: 'probe', code: ${JSON.stringify('__MOD_CODE__')} } });
window.__result = results;
</script>`;

/** mod として実行するコード。抜け道を試し、正規の経路で WASM・バイナリを扱って結果を Host に返す。 */
const MOD_CODE = `
const probes = {};
const attempt = async (name, fn) => {
    try { probes[name] = 'reachable:' + String(await fn()); }
    catch (error) { probes[name] = 'blocked:' + (error && error.name); }
};
(async () => {
    await attempt('prototypeFetch', () => Object.getPrototypeOf(self).fetch.call(self, '/api/v1/users/me'));
    await attempt('workerGlobalScopeFetch', () => WorkerGlobalScope.prototype.fetch.call(self, '/api/v1/users/me'));
    await attempt('functionConstructor', () => (() => {}).constructor('return 1')());
    await attempt('asyncFunctionConstructor', () => (async () => {}).constructor('return 1')());
    await attempt('stringTimer', () => setTimeout('1', 0));
    await attempt('caches', () => caches.open('x'));
    await attempt('indexedDB', () => indexedDB.open('x'));
    await attempt('xhr', () => new XMLHttpRequest());
    await attempt('webSocket', () => new WebSocket('ws://' + location.host + '/leak-ws'));
    await attempt('webTransport', () => new WebTransport('https://' + location.host + '/leak-wt'));
    await attempt('broadcastChannel', () => new BroadcastChannel('host'));
    await attempt('importScripts', () => importScripts('/leak-import-scripts.js'));
    await attempt('importCrossOrigin', () => import(location.protocol + '//localhost:' + location.port + '/leak-import.js'));
    await attempt('rawPostMessage', () => DedicatedWorkerGlobalScope.prototype.postMessage.call(self, { type: 'NETWORK_FETCH' }));

    const module = await Ubi.asset.wasm('fnv1a.wasm');
    const { exports } = await WebAssembly.instantiate(module, {});
    new Uint8Array(exports.memory.buffer).set([0x61]);
    const wasmHash = (exports.fnv1a(0, 1) >>> 0).toString(16);

    const res = await Ubi.fetch('https://api.example.com/bin', { responseType: 'arrayBuffer', signal: new AbortController().signal });

    const controller = new AbortController();
    const slow = Ubi.fetch('https://api.example.com/slow', { signal: controller.signal });
    controller.abort();
    const abortCode = await slow.then(() => 'resolved', (error) => error.code);

    Ubi.event.sendToHost('probes', {
        probes,
        wasmHash,
        fetchIsArrayBuffer: res.body instanceof ArrayBuffer,
        fetchBytes: Array.from(new Uint8Array(res.body)),
        abortCode,
        features: ['wasm', 'wasm:simd', 'asset', 'fetch:binary'].filter((f) => Ubi.runtime.supports(f)),
    });
})().catch((error) => Ubi.event.sendToHost('probes', { error: String(error && error.stack || error) }));
`;

/** Chrome DevTools Protocol の最小クライアント（ページで式を評価するだけ）。 */
async function evaluateInChrome(browserWsUrl: string, pageUrl: string, expression: string): Promise<unknown> {
    const ws = new WebSocket(browserWsUrl);
    await new Promise((resolve, reject) => {
        ws.addEventListener('open', resolve, { once: true });
        ws.addEventListener('error', reject, { once: true });
    });
    const pending = new Map<number, (message: { result?: unknown; error?: unknown }) => void>();
    ws.addEventListener('message', (event) => {
        const message = JSON.parse(String(event.data)) as { id?: number; result?: unknown; error?: unknown };
        if (message.id !== undefined) pending.get(message.id)?.(message);
    });
    const send = (method: string, params: object, sessionId?: string) =>
        new Promise<Record<string, unknown>>((resolve, reject) => {
            const id = pending.size + 1;
            pending.set(id, (message) =>
                message.error
                    ? reject(new Error(JSON.stringify(message.error)))
                    : resolve(message.result as Record<string, unknown>),
            );
            ws.send(JSON.stringify({ id, method, params, sessionId }));
        });
    try {
        const { targetId } = await send('Target.createTarget', { url: pageUrl });
        const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
        const evaluated = await send(
            'Runtime.evaluate',
            { expression, awaitPromise: true, returnByValue: true },
            sessionId as string,
        );
        return (evaluated.result as { value?: unknown }).value;
    } finally {
        ws.close();
    }
}

describe.skipIf(!chromePath)('Sandbox Worker（実ブラウザ）', () => {
    let server: Server;
    let chrome: ChildProcess;
    let profileDir: string;
    let browserWsUrl: string;
    let origin: string;
    const hits: string[] = [];
    let result: Record<string, unknown>;

    beforeAll(async () => {
        const workerCode = await bundleSandboxWorker();
        const wasm = readFileSync(join(packagesDir, '../mods/wasm-demo/assets/fnv1a.wasm'));
        const page = HOST_PAGE.replace(JSON.stringify('__MOD_CODE__'), JSON.stringify(MOD_CODE));

        server = createServer((req, res) => {
            const pathname = new URL(req.url ?? '/', 'http://x').pathname;
            if (pathname === '/') {
                res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(page);
            } else if (pathname === WORKER_PATH) {
                const headers: Record<string, string> = { 'content-type': 'text/javascript' };
                if (isSandboxWorkerScriptPath(pathname)) headers['content-security-policy'] = SANDBOX_WORKER_CSP;
                res.writeHead(200, headers).end(workerCode);
            } else if (pathname === '/wasm/fnv1a.wasm') {
                res.writeHead(200, { 'content-type': 'application/wasm' }).end(wasm);
            } else if (pathname === '/favicon.ico') {
                res.writeHead(404).end();
            } else {
                hits.push(pathname);
                res.writeHead(200, { 'content-type': 'text/javascript', 'access-control-allow-origin': '*' }).end(
                    'export default 1;',
                );
            }
        });
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

        profileDir = mkdtempSync(join(tmpdir(), 'ubichill-chrome-'));
        chrome = spawn(
            chromePath as string,
            [
                '--headless=new',
                '--remote-debugging-port=0',
                `--user-data-dir=${profileDir}`,
                '--no-first-run',
                '--no-default-browser-check',
                '--disable-gpu',
                ...(process.platform === 'linux' ? ['--no-sandbox'] : []),
                'about:blank',
            ],
            { stdio: ['ignore', 'ignore', 'pipe'] },
        );
        browserWsUrl = await new Promise<string>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('Chrome の DevTools が起動しませんでした')), 20_000);
            chrome.stderr?.on('data', (chunk: Buffer) => {
                const match = /DevTools listening on (ws:\/\/\S+)/.exec(chunk.toString());
                if (match?.[1]) {
                    clearTimeout(timer);
                    resolve(match[1]);
                }
            });
        });

        const json = await evaluateInChrome(
            browserWsUrl,
            `${origin}/`,
            `new Promise((resolve) => {
                const timer = setInterval(() => {
                    if (!window.__done) return;
                    clearInterval(timer);
                    setTimeout(() => resolve(JSON.stringify(window.__result)), 200);
                }, 20);
            })`,
        );
        result = JSON.parse(String(json));
    }, 60_000);

    afterAll(async () => {
        if (chrome && chrome.exitCode === null) {
            const exited = new Promise((resolve) => chrome.once('exit', resolve));
            chrome.kill();
            await exited;
        }
        await new Promise((resolve) => server?.close(resolve));
        if (profileDir) rmSync(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    });

    it('封鎖に成功して mod が起動する（fail closed にならない）', () => {
        expect(result.initFailed).toBeNull();
        expect(result.probes).toBeTruthy();
        expect((result.probes as { error?: string }).error).toBeUndefined();
    });

    it('通信・保存・スクリプト読み込み・コード生成の抜け道はすべて塞がれている', () => {
        const probes = (result.probes as { probes: Record<string, string> }).probes;
        const reachable = Object.entries(probes).filter(([, outcome]) => !outcome.startsWith('blocked:'));
        expect(reachable).toEqual([]);
        expect(Object.keys(probes)).toHaveLength(14);
    });

    it('サーバーには 1 件も届いていない（本体 API・外部への持ち出しが起きていない）', () => {
        expect(hits).toEqual([]);
    });

    it('同梱 WASM を CSP の下でコンパイル・実行できる', () => {
        expect((result.probes as { wasmHash: string }).wasmHash).toBe('e40c292c');
    });

    it('バイナリの応答はコピーせずに Worker へ移り、バイト列が壊れない', () => {
        const probes = result.probes as { fetchIsArrayBuffer: boolean; fetchBytes: number[] };
        expect(probes.fetchIsArrayBuffer).toBe(true);
        expect(probes.fetchBytes).toEqual([0, 255, 1, 254]);
        expect(result.hostBufferDetached).toBe(true);
        expect(result.fetchOptions).toEqual({ responseType: 'arrayBuffer' });
    });

    it('取り消すと mod は FETCH_ABORTED を受け取り、Host には CMD_ABORT が届く', () => {
        expect((result.probes as { abortCode: string }).abortCode).toBe('FETCH_ABORTED');
        expect(result.aborted).toMatch(/^rpc_/);
    });

    it('実ブラウザで wasm / wasm:simd / asset / fetch:binary を使えると判定する', () => {
        expect((result.probes as { features: string[] }).features).toEqual([
            'wasm',
            'wasm:simd',
            'asset',
            'fetch:binary',
        ]);
    });
});
