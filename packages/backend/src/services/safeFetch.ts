import dns from 'node:dns/promises';
import net from 'node:net';

/**
 * SSRF 対策付き fetch。
 *
 * 連合・共有 URL 入室などで、サーバーが**ユーザー指定の任意 URL** を取得する箇所に使う。
 * 内部/クラウドメタデータ等への到達を防ぐ：
 *   - スキームは http/https のみ
 *   - ホストが loopback / private / link-local(169.254=メタデータ) / ULA / multicast に
 *     解決される場合は拒否
 *   - リダイレクト（Location）先も毎回再検証する
 *
 * NOTE: DNS リバインディング（検証後に別 IP へ再解決）は完全には防げない。
 * 完全防御には解決済み IP を接続にピン留めする必要がある（将来課題）。
 * 開発で localhost ピアを試すときは WORLDS_FETCH_ALLOW_PRIVATE=true で緩和できる。
 */

const ALLOW_PRIVATE = process.env.WORLDS_FETCH_ALLOW_PRIVATE === 'true';

function isBlockedIPv4(ip: string): boolean {
    const p = ip.split('.').map(Number);
    if (p.length !== 4 || p.some((n) => Number.isNaN(n))) return true;
    const [a, b] = p;
    return (
        a === 0 ||
        a === 127 || // loopback
        a === 10 || // private
        (a === 169 && b === 254) || // link-local（クラウドメタデータ 169.254.169.254 を含む）
        (a === 172 && b >= 16 && b <= 31) || // private
        (a === 192 && b === 168) || // private
        (a === 100 && b >= 64 && b <= 127) || // CGNAT
        a >= 224 // multicast / reserved
    );
}

function isBlockedIPv6(ip: string): boolean {
    const s = ip.toLowerCase();
    if (s === '::1' || s === '::') return true;
    if (s.startsWith('fe8') || s.startsWith('fe9') || s.startsWith('fea') || s.startsWith('feb')) return true; // link-local
    if (s.startsWith('fc') || s.startsWith('fd')) return true; // ULA
    const mapped = /::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s);
    if (mapped) return isBlockedIPv4(mapped[1]);
    return false;
}

function isBlockedIP(ip: string): boolean {
    if (net.isIPv4(ip)) return isBlockedIPv4(ip);
    if (net.isIPv6(ip)) return isBlockedIPv6(ip);
    return true; // 判別不能は拒否
}

/** URL が外部公開ホストを指すか検証する。内部/loopback/メタデータ等なら throw。 */
export async function assertPublicUrl(rawUrl: string): Promise<void> {
    let u: URL;
    try {
        u = new URL(rawUrl);
    } catch {
        throw new Error(`不正な URL: ${rawUrl}`);
    }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') {
        throw new Error(`許可されないスキーム: ${u.protocol}`);
    }
    if (ALLOW_PRIVATE) return;

    const host = u.hostname.replace(/^\[|\]$/g, '');
    if (host === 'localhost' || host.endsWith('.localhost')) {
        throw new Error(`内部ホストへのアクセスは禁止: ${host}`);
    }
    if (net.isIP(host)) {
        if (isBlockedIP(host)) throw new Error(`内部 IP へのアクセスは禁止: ${host}`);
        return;
    }
    const addrs = await dns.lookup(host, { all: true });
    for (const a of addrs) {
        if (isBlockedIP(a.address)) throw new Error(`内部 IP に解決されるホストは禁止: ${host} -> ${a.address}`);
    }
}

/** SSRF 検証＋リダイレクト再検証付き fetch。 */
export async function safeFetch(rawUrl: string, init?: RequestInit & { maxRedirects?: number }): Promise<Response> {
    const maxRedirects = init?.maxRedirects ?? 3;
    let url = rawUrl;
    for (let hop = 0; hop <= maxRedirects; hop++) {
        await assertPublicUrl(url);
        const res = await fetch(url, { ...init, redirect: 'manual' });
        const location = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
        if (!location) return res;
        url = new URL(location, url).toString();
    }
    throw new Error(`リダイレクトが多すぎます: ${rawUrl}`);
}
