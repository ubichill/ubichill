/** スモークを走らせる先。テスト用のアカウント・インスタンスを作るので、本番には走らせない。 */
export interface SmokeTarget {
    /** 画面（frontend）のオリジン（例: https://pr-214.ubichill.com）。ブラウザで開き、API の origin ヘッダーにも使う */
    readonly origin: string;
    /** API（backend）のオリジン。プレビューは画面と同じ。ローカルの pnpm dev は画面 :3000・API :3001 に分かれる */
    readonly apiOrigin: string;
}

// 本番は登録にメール確認が要り、テストのデータも残るため断る
const PRODUCTION_HOSTS: ReadonlySet<string> = new Set(['ubichill.com', 'www.ubichill.com']);

export function resolveTarget(raw: string | undefined, rawApi?: string): SmokeTarget {
    if (!raw) throw new Error('スモークの対象の URL を渡してください（例: https://pr-123.ubichill.com）');
    const url = checkedUrl(raw);
    const api = rawApi ? checkedUrl(rawApi) : defaultApiUrl(url);
    return { origin: url.origin, apiOrigin: api.origin };
}

function checkedUrl(raw: string): URL {
    const url = parseUrl(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error(`http か https の URL を渡してください: ${raw}`);
    }
    if (PRODUCTION_HOSTS.has(url.hostname)) {
        throw new Error(`本番（${url.hostname}）には走らせません。プレビューかローカルの URL を渡してください`);
    }
    return url;
}

// frontend の lib/api.ts と同じ決め方: localhost の画面は :3001 の backend を呼ぶ
function defaultApiUrl(url: URL): URL {
    if (url.hostname !== 'localhost') return url;
    const api = new URL(url.origin);
    api.port = '3001';
    return api;
}

/** インスタンスの参加情報の url（相対・絶対・http(s)/ws(s) のどれでも）を WebSocket の URL にする。 */
export function socketUrl(origin: string, joinUrl: string): string {
    const url = new URL(joinUrl, origin);
    const protocol = { 'http:': 'ws:', 'https:': 'wss:', 'ws:': 'ws:', 'wss:': 'wss:' }[url.protocol];
    if (!protocol) throw new Error(`WebSocket にできない URL です: ${joinUrl}`);
    url.protocol = protocol;
    return url.toString();
}

function parseUrl(raw: string): URL {
    try {
        return new URL(raw);
    } catch {
        throw new Error(`URL として読めません: ${raw}`);
    }
}
