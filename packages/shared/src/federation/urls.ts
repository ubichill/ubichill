/**
 * 連合で使う URL の確かめ（オリジンによる信頼。FEP-fe34）。
 * shared は環境の型を持たないので、実行環境の URL（Node・ブラウザとも持つ）を最小の形で取り出す。
 */

interface ParsedUrl {
    protocol: string;
    username: string;
    password: string;
    hostname: string;
    host: string;
    port: string;
    origin: string;
    pathname: string;
    search: string;
    hash: string;
    href: string;
}

const parse = (input: string): ParsedUrl | null =>
    (globalThis as unknown as { URL: { parse(url: string): ParsedUrl | null } }).URL.parse(input);

/**
 * 連合の相手として受ける URL か。https（開発では http も）・資格情報なし・ホスト名あり。
 * 受けた URL は正規形（href）で比べる。
 */
export function parseFederationUrl(input: unknown, options: { allowHttp?: boolean } = {}): ParsedUrl | null {
    if (typeof input !== 'string' || input.length > 2048) return null;
    const url = parse(input);
    if (!url) return null;
    if (url.protocol !== 'https:' && !(options.allowHttp && url.protocol === 'http:')) return null;
    if (url.username || url.password || !url.hostname) return null;
    return url;
}

/** 2 つの URL が同じオリジンか（どちらかが読めなければ false）。 */
export function sameOrigin(a: string, b: string): boolean {
    const x = parse(a);
    const y = parse(b);
    return !!x && !!y && x.origin === y.origin;
}

/** URL のオリジン（読めなければ null）。 */
export function originOf(input: string): string | null {
    return parse(input)?.origin ?? null;
}

/** URL のホスト（小文字・ポート付き。アカウントの domain と同じ形）。 */
export function hostOf(input: string): string | null {
    return parse(input)?.host.toLowerCase() ?? null;
}

/** `https://<domain>` の形のオリジン（開発では http）。アカウントの domain からホームを引くとき。 */
export function originForDomain(domain: string, options: { allowHttp?: boolean } = {}): string[] {
    return options.allowHttp ? [`https://${domain}`, `http://${domain}`] : [`https://${domain}`];
}

/** ブラウザの origin（`scheme://host[:port]` だけ）として正しいか。 */
export function isBrowserOrigin(input: unknown, options: { allowHttp?: boolean } = {}): input is string {
    const url = parseFederationUrl(input, options);
    return !!url && url.origin === input;
}
