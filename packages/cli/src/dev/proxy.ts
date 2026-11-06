/**
 * `/realtime/v1/*` を Go へ中継する（HTTP と WebSocket）。ブラウザから見て Go は dev サーバーと同じオリジンになり、
 * `world.html` は「Go と同じオリジン」の前提のまま動く。Origin ヘッダはそのまま渡す（Go がそれを検査する）。
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { request } from 'node:http';
import { connect, type Socket } from 'node:net';
import type { Duplex } from 'node:stream';

export const REALTIME_PREFIX = '/realtime/v1/';

export const isRealtimePath = (pathname: string): boolean => pathname.startsWith(REALTIME_PREFIX);

export function proxyHttp(req: IncomingMessage, res: ServerResponse, port: number): void {
    const upstream = request(
        { host: '127.0.0.1', port, method: req.method, path: req.url, headers: req.headers },
        (upstreamRes) => {
            res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
            upstreamRes.pipe(res);
        },
    );
    upstream.on('error', () => {
        if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'instance server is not running' }));
    });
    req.pipe(upstream);
}

/** WebSocket の upgrade を生の TCP で中継する（リクエストの先頭をそのまま書き、以後は双方向に流す）。 */
export function proxyUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer, port: number): void {
    const upstream: Socket = connect(port, '127.0.0.1', () => {
        const headers = Object.entries(req.headers)
            .flatMap(([name, value]) => (Array.isArray(value) ? value.map((v) => [name, v]) : [[name, value]]))
            .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
            .map(([name, value]) => `${name}: ${value}`);
        upstream.write(`${req.method} ${req.url} HTTP/${req.httpVersion}\r\n${headers.join('\r\n')}\r\n\r\n`);
        if (head.length > 0) upstream.write(head);
        upstream.pipe(socket);
        socket.pipe(upstream);
    });
    upstream.on('error', () => socket.destroy());
    socket.on('error', () => upstream.destroy());
    socket.on('close', () => upstream.destroy());
}
