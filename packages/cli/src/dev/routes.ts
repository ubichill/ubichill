/**
 * dev サーバーの URL の解釈（純粋）。世代の URL は不変で、パスの各要素は厳しく検査する
 * （成果物はメモリの Map から引くので辿り上がりは起きないが、形の違うものは早く 404 にする）。
 */
import { extname } from 'node:path';

export type DevRoute =
    | { kind: 'events' }
    | { kind: 'reconfigure' }
    | { kind: 'lock'; buildId: string }
    | { kind: 'mod-file'; buildId: string; modId: string; version: string; file: string }
    | { kind: 'realtime' }
    | { kind: 'asset'; file: string }
    | { kind: 'page' }
    | { kind: 'not-found' };

const BUILD_ID = /^[A-Za-z0-9_-]+$/;
const MOD_ID = /^[a-z0-9-]+$/;
const VERSION = /^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/;
const SEGMENT = /^[A-Za-z0-9._@-]+$/;

/** パスの残り（`a/b/c`）が安全な相対パスか（`..`・空・`\`・不正な文字を含まない）。 */
export function safeRelativePath(segments: readonly string[]): string | null {
    if (segments.length === 0) return null;
    for (const segment of segments) {
        if (segment === '..' || segment === '.' || !SEGMENT.test(segment)) return null;
    }
    return segments.join('/');
}

export function matchRoute(method: string, pathname: string): DevRoute {
    const segments = pathname
        .split('/')
        .slice(1)
        .map((s) => {
            try {
                return decodeURIComponent(s);
            } catch {
                return '\u0000';
            }
        });
    if (pathname === '/__ubichill/events') return method === 'GET' ? { kind: 'events' } : { kind: 'not-found' };
    if (pathname === '/__ubichill/reconfigure')
        return method === 'POST' ? { kind: 'reconfigure' } : { kind: 'not-found' };
    if (segments[0] === '__ubichill' && segments[1] === 'g') {
        if (method !== 'GET') return { kind: 'not-found' };
        const buildId = segments[2] ?? '';
        if (!BUILD_ID.test(buildId)) return { kind: 'not-found' };
        if (segments.length === 4 && segments[3] === 'lock.json') return { kind: 'lock', buildId };
        const [, , , mods, modId = '', versionDir = '', ...rest] = segments;
        const version = versionDir.startsWith('v') ? versionDir.slice(1) : '';
        const file = safeRelativePath(rest);
        if (mods !== 'mods' || !MOD_ID.test(modId) || !VERSION.test(version) || file === null)
            return { kind: 'not-found' };
        return { kind: 'mod-file', buildId, modId, version, file };
    }
    if (segments[0] === '__ubichill') return { kind: 'not-found' };
    if (pathname.startsWith('/realtime/v1/')) return { kind: 'realtime' };
    if (
        segments[0] === 'assets' ||
        (segments.length === 1 && extname(segments[0] ?? '') !== '' && segments[0] !== 'world.html')
    ) {
        if (method !== 'GET' && method !== 'HEAD') return { kind: 'not-found' };
        const file = safeRelativePath(segments);
        return file === null ? { kind: 'not-found' } : { kind: 'asset', file };
    }
    return method === 'GET' || method === 'HEAD' ? { kind: 'page' } : { kind: 'not-found' };
}

const CONTENT_TYPES: Record<string, string> = {
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.wasm': 'application/wasm',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.txt': 'text/plain; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
    '.woff2': 'font/woff2',
    '.mp3': 'audio/mpeg',
    '.ogg': 'audio/ogg',
    '.mp4': 'video/mp4',
};

export const contentTypeOf = (file: string): string =>
    CONTENT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream';

/** `world.html` に dev の印を差し込む（`world.html` はこれを見て dev サーバーの世代を購読する）。 */
export const DEV_META = '<meta name="ubichill-dev" content="1">';

export function withDevMeta(html: string): string {
    return html.includes(DEV_META) ? html : html.replace(/<head>/i, `<head>\n    ${DEV_META}`);
}
