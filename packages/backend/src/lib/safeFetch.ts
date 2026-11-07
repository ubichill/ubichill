import dns from 'node:dns';
import net from 'node:net';
import { Agent, fetch as undiciFetch } from 'undici';

/**
 * SSRF 対策付き fetch。
 *
 * 連合・共有 URL 入室などで、サーバーが**ユーザー指定の任意 URL** を取得する箇所に使う。
 * 内部/クラウドメタデータ等への到達を防ぐ：
 *   - スキームは http/https のみ
 *   - 接続先 IP が公開アドレスでなければ拒否（IPv4 射影・NAT64 などの書き方の違いも含む）
 *   - 判定は接続に使う DNS 解決そのものの結果で行う（検証後に別 IP へ再解決させる DNS リバインディングを防ぐ）
 *   - リダイレクト先も毎回再検証し、ホストが変わったら Authorization を外す
 *   - 応答本文の大きさと全体の時間に上限を設ける
 * 開発で localhost ピアを試すときは WORLDS_FETCH_ALLOW_PRIVATE=true で緩和できる。
 */

const ALLOW_PRIVATE = process.env.WORLDS_FETCH_ALLOW_PRIVATE === 'true';

/** 既定の応答本文の上限。呼び出し側が `maxBytes` でさらに絞る。 */
export const SAFE_FETCH_MAX_BYTES = 2 * 1024 * 1024;
export const SAFE_FETCH_TIMEOUT_MS = 10_000;

const NON_PUBLIC = (() => {
    const list = new net.BlockList();
    const v4: Array<[string, number]> = [
        ['0.0.0.0', 8],
        ['10.0.0.0', 8],
        ['100.64.0.0', 10], // CGNAT
        ['127.0.0.0', 8],
        ['169.254.0.0', 16], // link-local（クラウドメタデータ 169.254.169.254 を含む）
        ['172.16.0.0', 12],
        ['192.0.0.0', 24],
        ['192.0.2.0', 24],
        ['192.168.0.0', 16],
        ['198.18.0.0', 15],
        ['198.51.100.0', 24],
        ['203.0.113.0', 24],
        ['224.0.0.0', 4], // multicast
        ['240.0.0.0', 4], // reserved・broadcast
    ];
    // IPv4 射影（::ffff:0:0/96）は BlockList が IPv4 の規則で判定する。
    // ほかに IPv4 を埋め込める変換用の範囲は、公開サーバーが使う理由が無いので丸ごと拒否する。
    const v6: Array<[string, number]> = [
        ['::', 96], // 未指定・loopback・IPv4 互換（::a.b.c.d）
        ['64:ff9b::', 96], // NAT64
        ['64:ff9b:1::', 48], // ローカル NAT64
        ['100::', 64], // discard
        ['2001::', 32], // Teredo
        ['2001:db8::', 32], // 文書用
        ['2002::', 16], // 6to4
        ['fc00::', 7], // ULA
        ['fe80::', 10], // link-local
        ['fec0::', 10], // site-local（廃止）
        ['ff00::', 8], // multicast
    ];
    for (const [address, prefix] of v4) list.addSubnet(address, prefix, 'ipv4');
    for (const [address, prefix] of v6) list.addSubnet(address, prefix, 'ipv6');
    return list;
})();

/** 公開アドレスでなければ true。IP として読めないものも拒否する。 */
export function isNonPublicIP(ip: string): boolean {
    const family = net.isIP(ip);
    if (family === 0) return true;
    return NON_PUBLIC.check(ip, family === 4 ? 'ipv4' : 'ipv6');
}

function parseUrl(rawUrl: string): URL {
    let u: URL;
    try {
        u = new URL(rawUrl);
    } catch {
        throw new Error(`不正な URL: ${rawUrl}`);
    }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') {
        throw new Error(`許可されないスキーム: ${u.protocol}`);
    }
    return u;
}

function assertPublicHostLiteral(host: string): void {
    if (host === 'localhost' || host.endsWith('.localhost')) {
        throw new Error(`内部ホストへのアクセスは禁止: ${host}`);
    }
    if (net.isIP(host) && isNonPublicIP(host)) throw new Error(`内部 IP へのアクセスは禁止: ${host}`);
}

/**
 * URL が外部公開ホストを指すか検証する。内部/loopback/メタデータ等なら throw。
 * 取得せずに URL を受け付けるだけの箇所の事前確認用。取得は {@link safeFetch} が接続時にも確かめる。
 */
export async function assertPublicUrl(rawUrl: string): Promise<void> {
    const u = parseUrl(rawUrl);
    if (ALLOW_PRIVATE) return;
    const host = u.hostname.replace(/^\[|\]$/g, '');
    assertPublicHostLiteral(host);
    if (net.isIP(host)) return;
    const addrs = await dns.promises.lookup(host, { all: true });
    for (const a of addrs) {
        if (isNonPublicIP(a.address)) throw new Error(`内部 IP に解決されるホストは禁止: ${host} -> ${a.address}`);
    }
}

type LookupCallback = (
    err: NodeJS.ErrnoException | null,
    address: string | dns.LookupAddress[],
    family?: number,
) => void;

type Resolve = (
    hostname: string,
    options: dns.LookupAllOptions,
    callback: (err: NodeJS.ErrnoException | null, addresses: dns.LookupAddress[]) => void,
) => void;

/** 接続に使う DNS 解決。解決結果に公開でないアドレスが 1 つでもあれば接続させない。 */
export const createPublicOnlyLookup =
    (resolve: Resolve) =>
    (hostname: string, options: dns.LookupOptions, callback: LookupCallback): void =>
        resolve(hostname, { ...options, all: true }, (err, addresses) => {
            if (err) return callback(err, []);
            const blocked = addresses.find((a) => isNonPublicIP(a.address));
            if (blocked) {
                return callback(
                    Object.assign(new Error(`内部 IP に解決されるホストは禁止: ${hostname} -> ${blocked.address}`), {
                        code: 'ENOTPUBLIC',
                    }),
                    [],
                );
            }
            if (options.all) return callback(null, addresses);
            const [first] = addresses;
            if (!first)
                return callback(Object.assign(new Error(`解決できません: ${hostname}`), { code: 'ENOTFOUND' }), []);
            return callback(null, first.address, first.family);
        });

const publicOnlyAgent = new Agent({ connect: { lookup: createPublicOnlyLookup(dns.lookup) } });

/** 上限を超えた時点で読み込みをやめる本文。 */
function limitBody(
    body: ReadableStream<Uint8Array> | null,
    maxBytes: number,
    url: string,
): ReadableStream<Uint8Array> | null {
    if (!body) return null;
    const reader = body.getReader();
    const state = { received: 0 };
    return new ReadableStream<Uint8Array>({
        async pull(controller) {
            const { done, value } = await reader.read();
            if (done) return controller.close();
            state.received += value.byteLength;
            if (state.received > maxBytes) {
                await reader.cancel();
                return controller.error(new Error(`応答が大きすぎます (> ${maxBytes} bytes): ${url}`));
            }
            controller.enqueue(value);
        },
        cancel(reason) {
            return reader.cancel(reason);
        },
    });
}

const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304]);

export interface SafeFetchInit extends Omit<RequestInit, 'redirect'> {
    maxRedirects?: number;
    /** 応答本文の上限（既定 {@link SAFE_FETCH_MAX_BYTES}）。超えると本文の読み込みが失敗する。 */
    maxBytes?: number;
}

function withoutAuthorization(headers: RequestInit['headers']): Headers {
    const next = new Headers(headers);
    next.delete('authorization');
    next.delete('cookie');
    return next;
}

/** SSRF 検証＋リダイレクト再検証付き fetch。 */
export async function safeFetch(rawUrl: string, init: SafeFetchInit = {}): Promise<Response> {
    const { maxRedirects = 3, maxBytes = SAFE_FETCH_MAX_BYTES, signal, ...rest } = init;
    const timeout = AbortSignal.timeout(SAFE_FETCH_TIMEOUT_MS);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const origin = parseUrl(rawUrl).origin;

    const fetchHop = async (url: string, hop: number): Promise<Response> => {
        const u = parseUrl(url);
        if (!ALLOW_PRIVATE) assertPublicHostLiteral(u.hostname.replace(/^\[|\]$/g, ''));
        const headers = u.origin === origin ? new Headers(rest.headers) : withoutAuthorization(rest.headers);
        const res = await undiciFetch(url, {
            ...(rest as Parameters<typeof undiciFetch>[1]),
            headers,
            signal: combined,
            redirect: 'manual',
            ...(ALLOW_PRIVATE ? {} : { dispatcher: publicOnlyAgent }),
        });
        const location = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
        if (location) {
            await res.body?.cancel();
            if (hop >= maxRedirects) throw new Error(`リダイレクトが多すぎます: ${rawUrl}`);
            return fetchHop(new URL(location, url).toString(), hop + 1);
        }
        const body = NULL_BODY_STATUSES.has(res.status)
            ? null
            : limitBody(res.body as ReadableStream<Uint8Array> | null, maxBytes, url);
        return new Response(body, {
            status: res.status,
            statusText: res.statusText,
            headers: new Headers([...res.headers]),
        });
    };
    return fetchHop(rawUrl, 0);
}
