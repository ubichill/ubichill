/**
 * dev サーバーの HTTP（実際にポートを開いて確かめる）。世代の URL は不変で、切り替えをまたいでも前の世代の中身が返る。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fakeMod } from './generation.test.ts';
import { type Generation, type GenerationState, initialGenerationState, publishGeneration } from './generation.ts';
import { absolutizeLock, createDevServer, type DevServer, formatSse } from './server.ts';

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

    it('SSE は繋いだ直後に今の世代を送り、broadcast が全員に届く', async () => {
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
        expect(await read('event: generation')).toContain(
            formatSse({ type: 'generation', buildId: 'r-4', instanceId: 'dev-r-4' }),
        );
        dev.current?.broadcast({ type: 'build-error', mod: 'pen', message: 'boom' });
        expect(await read('build-error')).toContain('data: {"mod":"pen","message":"boom"}');
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
