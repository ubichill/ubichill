/**
 * dev サーバーの HTTP（実際にポートを開いて確かめる）。世代の URL は不変で、切り替えをまたいでも前の世代の中身が返る。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type DevFailure, formatDevEvent } from '@ubichill/shared';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { fakeMod } from './generation.test.ts';
import { type Generation, type GenerationState, initialGenerationState, publishGeneration } from './generation.ts';
import { absolutizeLock, createDevServer, type DevServer } from './server.ts';

const gen = (buildId: string, version: string, manifest: string): Generation => {
    const mod = fakeMod('pen', version);
    return {
        buildId,
        mods: new Map([
            [
                'pen',
                {
                    ...mod,
                    files: new Map([
                        ['manifest.json', new TextEncoder().encode(manifest)],
                        ['pen/index.00000000.js', new TextEncoder().encode(`// ${buildId}`)],
                        ['a.wasm', new Uint8Array([0, 97, 115, 109])],
                    ]),
                },
            ],
        ]),
        lock: { lockVersion: 1, mods: { pen: { ...mod.lockEntry, baseUrl: `/__ubichill/g/${buildId}/mods` } } },
        instanceId: `dev-${buildId}`,
    };
};

const listen = (server: Server): Promise<string> =>
    new Promise((resolve) =>
        server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)),
    );

describe('createDevServer', () => {
    const worldDist = mkdtempSync(join(tmpdir(), 'ubichill-world-dist-'));
    const state = { current: initialGenerationState('r') as GenerationState };
    const reconfigures: number[] = [];
    const diagnostics = { current: [{ kind: 'world', message: 'kind が違う' }] as DevFailure[] };
    const go = { port: undefined as number | undefined, server: undefined as Server | undefined };
    const dev = { current: undefined as DevServer | undefined };
    const origin = { current: '' };

    beforeAll(async () => {
        mkdirSync(join(worldDist, 'assets'));
        writeFileSync(join(worldDist, 'world.html'), '<html><head><title>w</title></head><body></body></html>');
        writeFileSync(join(worldDist, 'assets', 'world-abc.js'), 'console.log(1)');
        writeFileSync(join(worldDist, 'assets', 'sandbox.worker-abc.js'), 'self.x = 1');
        writeFileSync(join(worldDist, 'package.json'), '{"secret":true}');
        go.server = createServer((req, res) => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ proxied: req.url, origin: req.headers.origin ?? null }));
        });
        go.port = Number((await listen(go.server)).split(':').pop());
        dev.current = createDevServer({
            state: () => state.current,
            diagnostics: () => diagnostics.current,
            goPort: () => go.port,
            worldDist,
            onReconfigure: () => reconfigures.push(1),
        });
        origin.current = await listen(dev.current.server);
    });
    afterAll(async () => {
        await dev.current?.close();
        go.server?.close();
        rmSync(worldDist, { recursive: true, force: true });
    });

    const get = (path: string, init?: RequestInit) => fetch(`${origin.current}${path}`, init);

    it('ページには dev の印が入り、キャッシュしない', async () => {
        const res = await get('/room-1');
        expect(res.status).toBe(200);
        expect(res.headers.get('cache-control')).toBe('no-store');
        expect(await res.text()).toContain('<meta name="ubichill-dev"');
    });

    it('世代の lock と成果物は不変（切り替えた後も前の世代が同じ中身で返る）、無い世代は 404', async () => {
        state.current = publishGeneration(state.current, gen('r-1', '1.0.0', '{"gen":1}'));
        const lock1 = await get('/__ubichill/g/r-1/lock.json');
        expect(lock1.headers.get('cache-control')).toContain('immutable');
        // 相対で持つ baseUrl は、ブラウザが使ったオリジン付きで配る（lock の baseUrl は絶対 URL）
        expect(((await lock1.json()) as { mods: { pen: { baseUrl: string } } }).mods.pen.baseUrl).toBe(
            `${origin.current}/__ubichill/g/r-1/mods`,
        );
        state.current = publishGeneration(state.current, gen('r-2', '1.0.1', '{"gen":2}'));
        // 世代 1 の lock を取ったページが、切り替え後に世代 1 の manifest と Worker を取っても一致する
        expect(await (await get('/__ubichill/g/r-1/mods/pen/v1.0.0/manifest.json')).text()).toBe('{"gen":1}');
        const worker = await get('/__ubichill/g/r-1/mods/pen/v1.0.0/pen/index.00000000.js');
        expect(worker.headers.get('content-type')).toContain('javascript');
        expect(await worker.text()).toBe('// r-1');
        expect(await (await get('/__ubichill/g/r-2/mods/pen/v1.0.1/manifest.json')).text()).toBe('{"gen":2}');
        // 版の違う URL・無い世代は 404
        expect((await get('/__ubichill/g/r-1/mods/pen/v1.0.1/manifest.json')).status).toBe(404);
        expect((await get('/__ubichill/g/r-9/lock.json')).status).toBe(404);
        // 手元のビルドに署名は無い: 404（コンソールにエラー）ではなく 204（署名なし）。無い mod・無い世代は 404 のまま
        expect((await get('/__ubichill/g/r-2/mods/pen/v1.0.1/lock.sig.json')).status).toBe(204);
        expect((await get('/__ubichill/g/r-2/mods/other/v1.0.1/lock.sig.json')).status).toBe(404);
        expect((await get('/__ubichill/g/r-9/mods/pen/v1.0.1/lock.sig.json')).status).toBe(404);
        const wasm = await get('/__ubichill/g/r-2/mods/pen/v1.0.1/a.wasm');
        expect(wasm.headers.get('content-type')).toBe('application/wasm');
        expect(new Uint8Array(await wasm.arrayBuffer())).toEqual(new Uint8Array([0, 97, 115, 109]));
    });

    it('世代が 4 つ進むと最初の世代の URL は 404', async () => {
        state.current = publishGeneration(state.current, gen('r-3', '1.0.2', '{}'));
        state.current = publishGeneration(state.current, gen('r-4', '1.0.3', '{}'));
        expect((await get('/__ubichill/g/r-1/lock.json')).status).toBe(404);
        expect((await get('/__ubichill/g/r-2/lock.json')).status).toBe(200);
    });

    it('SSE は繋いだ直後に今の世代と今の診断を送り（先に起きた失敗も見える）、broadcast が全員に届く', async () => {
        const res = await get('/__ubichill/events');
        expect(res.headers.get('content-type')).toContain('text/event-stream');
        const reader = res.body?.getReader();
        const decoder = new TextDecoder();
        const read = async (expected: string) => {
            const buffer: string[] = [];
            while (!buffer.join('').includes(expected)) {
                const chunk = await reader?.read();
                if (!chunk || chunk.done) break;
                buffer.push(decoder.decode(chunk.value));
            }
            return buffer.join('');
        };
        const first = await read('event: diagnostics');
        expect(first).toContain(formatDevEvent({ type: 'generation', buildId: 'r-4', instanceId: 'dev-r-4' }));
        expect(first).toContain(formatDevEvent({ type: 'diagnostics', failures: diagnostics.current }));
        dev.current?.broadcast({ type: 'diagnostics', failures: [{ kind: 'build', mod: 'pen', message: 'boom' }] });
        expect(await read('boom')).toContain('data: {"failures":[{"kind":"build","mod":"pen","message":"boom"}]}');
        await reader?.cancel();
    });

    it('/realtime/v1/* は Origin を保ったまま Go へ中継し、それ以外の API は渡さない', async () => {
        const res = await get('/realtime/v1/instances/default', { headers: { Origin: 'http://localhost:3333' } });
        expect(await res.json()).toEqual({
            proxied: '/realtime/v1/instances/default',
            origin: 'http://localhost:3333',
        });
        expect((await get('/api/v1/instances')).headers.get('content-type')).toContain('text/html');
        const before = go.port;
        go.port = undefined;
        expect((await get('/realtime/v1/instances/default')).status).toBe(503);
        go.port = before;
    });

    it('静的ファイルは world の dist の中だけ。Sandbox Worker には CSP が付く', async () => {
        expect(await (await get('/assets/world-abc.js')).text()).toBe('console.log(1)');
        expect((await get('/assets/world-abc.js')).headers.get('cache-control')).toContain('immutable');
        expect((await get('/assets/sandbox.worker-abc.js')).headers.get('content-security-policy')).toContain(
            "default-src 'none'",
        );
        // fetch（WHATWG URL）は `..`・`%2e%2e` を送る前に解決する。辿り上がりの拒否は routes.test が raw のパスで確かめる
        expect((await get('/package.json')).status).toBe(200); // dist 直下のファイルは配る（icon.png と同じ扱い）
        expect((await get('/assets/missing.js')).status).toBe(404);
    });

    it('部屋を作り直すボタンは 202 で受け付け、判断は呼び出し側に渡す', async () => {
        expect((await get('/__ubichill/reconfigure', { method: 'POST' })).status).toBe(202);
        expect(reconfigures).toHaveLength(1);
    });
});

describe('absolutizeLock', () => {
    it('相対の baseUrl にだけオリジンを付け、外部の mod の baseUrl は変えない', () => {
        const entry = fakeMod('pen').lockEntry;
        const lock = absolutizeLock(
            {
                lockVersion: 1,
                mods: {
                    pen: { ...entry, baseUrl: '/__ubichill/g/r-1/mods' },
                    ext: { ...entry, id: 'ext', baseUrl: 'https://cdn.example/mods' },
                    bare: entry,
                },
            },
            'http://127.0.0.1:3333',
        );
        expect(lock.mods.pen?.baseUrl).toBe('http://127.0.0.1:3333/__ubichill/g/r-1/mods');
        expect(lock.mods.ext?.baseUrl).toBe('https://cdn.example/mods');
        expect(lock.mods.bare?.baseUrl).toBeUndefined();
    });
});

describe('close（WebSocket を中継しているとき）', () => {
    it('中継中の WebSocket があっても close が終わり、Go 側の接続も切れる', async () => {
        const worldDist = mkdtempSync(join(tmpdir(), 'ubichill-world-dist-'));
        writeFileSync(join(worldDist, 'world.html'), '<html><head></head></html>');
        // 偽の Go: upgrade を受けて 101 を返し、接続を開いたままにする
        const upstreamClosed = { value: false };
        const go = createServer();
        go.on('upgrade', (_req, socket) => {
            socket.write(
                'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: x\r\n\r\n',
            );
            // http.Server のソケットは half-open を許すので、相手が切ったことは 'end' で分かる
            for (const event of ['end', 'close']) {
                socket.on(event, () => {
                    upstreamClosed.value = true;
                });
            }
        });
        const goPort = Number((await listen(go)).split(':').pop());
        const dev = createDevServer({
            state: () => initialGenerationState('r'),
            diagnostics: () => [],
            goPort: () => goPort,
            worldDist,
            onReconfigure: () => {},
        });
        const origin = await listen(dev.server);
        const { connect } = await import('node:net');
        const client = connect(Number(origin.split(':').pop()), '127.0.0.1');
        await new Promise<void>((resolve) => client.on('connect', () => resolve()));
        client.write(
            'GET /realtime/v1/ws HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n',
        );
        await new Promise<void>((resolve) => client.once('data', () => resolve()));

        const closed = await Promise.race([
            dev.close().then(() => 'closed'),
            new Promise((resolve) => setTimeout(() => resolve('timeout'), 2000)),
        ]);
        expect(closed).toBe('closed');
        await vi.waitFor(() => expect(upstreamClosed.value).toBe(true), { timeout: 2000 });
        client.destroy();
        go.close();
        rmSync(worldDist, { recursive: true, force: true });
    });
});
