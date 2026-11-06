/**
 * dev サーバーの HTTP。世代の成果物（メモリ）・`world.html`・SSE・Go への中継。
 * 判断（何をビルドし、いつ世代を切り替えるか）は pipeline.ts。ここは配るだけ。
 */
import { existsSync, readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { join, resolve, sep } from 'node:path';
import { performance } from 'node:perf_hooks';
import type { Duplex } from 'node:stream';
import {
    type DevEvent,
    type DevFailure,
    formatDevEvent,
    isSandboxWorkerScriptPath,
    MOD_SIGNATURE_FILE,
    type ModLock,
    SANDBOX_WORKER_CSP,
} from '@ubichill/shared';
import { formatDuration, type Logger, silentLogger } from '@ubichill/terminal';
import { findGeneration, type Generation, type GenerationState } from './generation.ts';
import { isRealtimePath, proxyHttp, proxyUpgrade } from './proxy.ts';
import { contentTypeOf, matchRoute, withDevMeta } from './routes.ts';

export interface DevServerDeps {
    /** 今の世代の状態を読む（pipeline が持つ）。 */
    state: () => GenerationState;
    /** 今の診断（pipeline が持つ）。 */
    diagnostics: () => readonly DevFailure[];
    /** Go のポート（中継先）。落ちている間は undefined。 */
    goPort: () => number | undefined;
    /** `world.html` と assets のディレクトリ。 */
    worldDist: string;
    /** 「部屋を作り直す」ボタン。 */
    onReconfigure: () => void;
    /** 要求ごとの 1 行（debug）を出す先。 */
    log?: Logger;
}

export interface DevServer {
    server: Server;
    /** SSE の全接続に送る。 */
    broadcast(event: DevEvent): void;
    close(): Promise<void>;
}

const IMMUTABLE = 'public, max-age=31536000, immutable';

const generationEvent = (generation: Generation | undefined): DevEvent | null =>
    generation ? { type: 'generation', buildId: generation.buildId, instanceId: generation.instanceId } : null;

/**
 * 世代の lock の baseUrl は相対（`/__ubichill/g/<buildId>/mods`）で持ち、配るときにブラウザが使ったオリジンを付ける。
 * lock の baseUrl は絶対 URL と決まっており（ModLockEntrySchema）、localhost でも 127.0.0.1 でも同じオリジンから取れるようにする。
 */
export function absolutizeLock(lock: ModLock, origin: string): ModLock {
    return {
        ...lock,
        mods: Object.fromEntries(
            Object.entries(lock.mods).map(([id, entry]) => [
                id,
                entry.baseUrl?.startsWith('/') ? { ...entry, baseUrl: `${origin}${entry.baseUrl}` } : entry,
            ]),
        ),
    };
}

/** ブラウザが使ったオリジン（Host ヘッダから。TLS は dev サーバーに無い）。 */
export const requestOrigin = (req: Pick<IncomingMessage, 'headers'>): string =>
    `http://${req.headers.host ?? 'localhost'}`;

/** `GET /mods/... 200`。応答する前に切れた要求は状態の代わりに「切断」。 */
export const formatRequestLine = (method: string | undefined, url: string | undefined, status: number | undefined) =>
    `${method ?? '?'} ${url ?? '/'} ${status ?? '切断'}`;

export function createDevServer(deps: DevServerDeps): DevServer {
    const clients = new Set<ServerResponse>();
    // Upgrade した WebSocket は http.Server の接続の管理から外れる（closeAllConnections では閉じない）ので自分で持つ
    const upgraded = new Set<Duplex>();
    const pageHtml = () => withDevMeta(readFileSync(join(deps.worldDist, 'world.html'), 'utf-8'));
    const assetsRoot = resolve(deps.worldDist);

    const notFound = (res: ServerResponse) => {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end('not found');
    };

    const handle = (req: IncomingMessage, res: ServerResponse) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        const route = matchRoute(req.method ?? 'GET', url.pathname);
        switch (route.kind) {
            case 'events': {
                res.writeHead(200, {
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-store',
                    Connection: 'keep-alive',
                });
                res.write(': connected\n\n');
                // 繋いだ直後に今の世代と診断を送る。切断中に何回切り替わっても、繋ぎ直した時点の比較で追いつく
                const current = generationEvent(deps.state().kept[0]);
                if (current) res.write(formatDevEvent(current));
                res.write(formatDevEvent({ type: 'diagnostics', failures: [...deps.diagnostics()] }));
                clients.add(res);
                const heartbeat = setInterval(() => res.write(': ping\n\n'), 25000);
                req.on('close', () => {
                    clearInterval(heartbeat);
                    clients.delete(res);
                });
                return;
            }
            case 'reconfigure':
                deps.onReconfigure();
                res.writeHead(202, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
                res.end('{"accepted":true}');
                return;
            case 'lock': {
                const generation = findGeneration(deps.state(), route.buildId);
                if (!generation) return notFound(res);
                // 世代は不変だがオリジンはブラウザごとなので、lock は配るたびに作る（キャッシュはオリジンごとに別）
                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': IMMUTABLE });
                res.end(JSON.stringify(absolutizeLock(generation.lock, requestOrigin(req))));
                return;
            }
            case 'mod-file': {
                const generation = findGeneration(deps.state(), route.buildId);
                const mod = generation?.mods.get(route.modId);
                const known = mod && mod.version === route.version ? mod : undefined;
                const bytes = known?.files.get(route.file);
                // 手元のビルドに作者署名は無い。404 だとブラウザのコンソールに毎回エラーが出るので、204（中身なし = 署名なし）で答える
                if (!bytes && known && route.file === MOD_SIGNATURE_FILE) {
                    res.writeHead(204, { 'Cache-Control': IMMUTABLE });
                    res.end();
                    return;
                }
                if (!bytes) return notFound(res);
                res.writeHead(200, {
                    'Content-Type': contentTypeOf(route.file),
                    'Content-Length': bytes.byteLength,
                    'Cache-Control': IMMUTABLE,
                });
                res.end(Buffer.from(bytes));
                return;
            }
            case 'realtime': {
                const port = deps.goPort();
                if (port === undefined) {
                    res.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
                    res.end(JSON.stringify({ success: false, error: 'instance server is restarting' }));
                    return;
                }
                proxyHttp(req, res, port);
                return;
            }
            case 'asset': {
                const path = resolve(assetsRoot, ...route.file.split('/'));
                if (!path.startsWith(assetsRoot + sep) || !existsSync(path)) return notFound(res);
                const headers: Record<string, string> = {
                    'Content-Type': contentTypeOf(path),
                    'Cache-Control': route.file.startsWith('assets/') ? IMMUTABLE : 'no-store',
                };
                // Sandbox Worker の CSP は Worker スクリプト自身のレスポンスで決まる（BFF と同じ）
                if (isSandboxWorkerScriptPath(url.pathname)) headers['Content-Security-Policy'] = SANDBOX_WORKER_CSP;
                res.writeHead(200, headers);
                res.end(req.method === 'HEAD' ? undefined : readFileSync(path));
                return;
            }
            case 'page':
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
                res.end(req.method === 'HEAD' ? undefined : pageHtml());
                return;
            default:
                notFound(res);
        }
    };

    const log = deps.log ?? silentLogger;
    const server = createServer((req, res) => {
        const started = performance.now();
        // 閉じたときに出す（SSE は切れたとき。途中で切られた要求も残す）
        res.once('close', () =>
            log.debug(
                formatRequestLine(req.method, req.url, res.writableFinished ? res.statusCode : undefined),
                formatDuration(performance.now() - started),
            ),
        );
        try {
            handle(req, res);
        } catch (error) {
            log.error(`${req.method} ${req.url} を処理できません: ${error instanceof Error ? error.message : error}`);
            res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end(error instanceof Error ? error.message : String(error));
        }
    });
    server.on('upgrade', (req, socket, head) => {
        const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
        const port = deps.goPort();
        if (!isRealtimePath(pathname) || port === undefined) {
            log.debug(`WS ${pathname} を断りました`, port === undefined ? 'Go が起動し直している' : '中継しない URL');
            socket.destroy();
            return;
        }
        log.debug(`WS ${pathname} を Go に中継します`);
        upgraded.add(socket);
        socket.on('close', () => upgraded.delete(socket));
        proxyUpgrade(req, socket, head, port);
    });

    return {
        server,
        broadcast(event) {
            const payload = formatDevEvent(event);
            for (const client of clients) client.write(payload);
        },
        close() {
            for (const client of clients) client.end();
            clients.clear();
            // 中継中の WebSocket を切る（切ると Go への中継も proxyUpgrade の close で切れる）
            for (const socket of upgraded) socket.destroy();
            upgraded.clear();
            return new Promise((done) => {
                server.closeAllConnections();
                server.close(() => done());
            });
        },
    };
}
