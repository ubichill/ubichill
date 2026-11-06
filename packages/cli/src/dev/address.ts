/**
 * dev サーバーをどこで待ち受け、どの URL を案内し、Go にどのオリジンを許すか（Vite と同じく既定は手元だけ）。
 *
 *   （指定なし）     127.0.0.1 だけ。Local: http://localhost:<port>/
 *   --host           全部の口（LAN から開ける）。Network: に LAN の IPv4 を並べる
 *   --host=<addr>    その口だけ
 */
export type HostOption =
    | { readonly kind: 'loopback' }
    | { readonly kind: 'all' }
    | { readonly kind: 'address'; readonly host: string };

const ALL_ADDRESSES = new Set(['', '0.0.0.0', '::', 'true']);
const LOOPBACK_ADDRESSES = new Set(['localhost', '127.0.0.1', '::1']);

export function parseHostOption(argv: readonly string[]): HostOption {
    if (argv.includes('--host')) return { kind: 'all' };
    const value = argv.find((a) => a.startsWith('--host='))?.slice('--host='.length);
    if (value === undefined) return { kind: 'loopback' };
    const host = value.trim().replace(/^\[(.*)\]$/, '$1');
    return ALL_ADDRESSES.has(host) ? { kind: 'all' } : { kind: 'address', host };
}

/** `server.listen` に渡す host。全部の口は undefined（Node の既定: 使えれば IPv6 と IPv4 の両方）。 */
export function listenHost(option: HostOption): string | undefined {
    if (option.kind === 'loopback') return '127.0.0.1';
    if (option.kind === 'all') return undefined;
    return option.host;
}

export interface InterfaceAddress {
    readonly address: string;
    readonly family: string | number;
    readonly internal: boolean;
}

/** LAN の IPv4（`os.networkInterfaces()` から。loopback と IPv6 は除く。重複も除く）。 */
export function lanAddresses(interfaces: Readonly<Record<string, readonly InterfaceAddress[] | undefined>>): string[] {
    const addresses = Object.values(interfaces)
        .flatMap((list) => list ?? [])
        .filter((entry) => !entry.internal && (entry.family === 'IPv4' || entry.family === 4))
        .map((entry) => entry.address);
    return [...new Set(addresses)];
}

const urlHost = (host: string): string => (host.includes(':') ? `[${host}]` : host);

export interface DevUrls {
    /** この機械から開く URL（特定の LAN の口だけで待つときは無い）。 */
    readonly local?: string;
    /** ほかの機械から開く URL。 */
    readonly network: readonly string[];
}

export function devUrls(
    option: HostOption,
    port: number,
    interfaces: Readonly<Record<string, readonly InterfaceAddress[] | undefined>>,
): DevUrls {
    const local = `http://localhost:${port}/`;
    if (option.kind === 'loopback') return { local, network: [] };
    if (option.kind === 'all')
        return { local, network: lanAddresses(interfaces).map((address) => `http://${address}:${port}/`) };
    if (LOOPBACK_ADDRESSES.has(option.host))
        return { local: option.host === '::1' ? `http://[::1]:${port}/` : local, network: [] };
    return { network: [`http://${urlHost(option.host)}:${port}/`] };
}

/** Go の Origin 検査に通すオリジン。localhost と 127.0.0.1 はいつも、加えて案内する URL のオリジン。 */
export function devOrigins(urls: DevUrls, port: number): string[] {
    const fixed = [`http://localhost:${port}`, `http://127.0.0.1:${port}`];
    const shown = [urls.local, ...urls.network].flatMap((url) => (url ? [new URL(url).origin] : []));
    return [...new Set([...fixed, ...shown])];
}
