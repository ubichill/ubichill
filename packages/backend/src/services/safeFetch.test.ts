import type dns from 'node:dns';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { assertPublicUrl, createPublicOnlyLookup, isNonPublicIP, safeFetch } from './safeFetch';

/**
 * SSRF 判定の単体テスト。
 * IP リテラルは DNS 解決を伴わないので、ネットワーク無しで検証できる。
 * WORLDS_FETCH_ALLOW_PRIVATE は未設定前提（＝ブロック有効）。
 */
describe('assertPublicUrl', () => {
    const blocked = [
        'http://169.254.169.254/latest/meta-data/', // クラウドメタデータ
        'http://127.0.0.1/x', // loopback
        'http://10.0.0.5/x', // private
        'http://172.16.0.1/x', // private
        'http://192.168.1.1/x', // private
        'http://100.64.0.1/x', // CGNAT
        'http://localhost:3001/x', // localhost 名
        'https://[::1]/x', // IPv6 loopback
        'https://[fd00::1]/x', // IPv6 ULA
        'file:///etc/passwd', // 非 http スキーム
        'ftp://example.com/x', // 非 http スキーム
        // URL パーサーが 16 進に直す IPv4 射影（::ffff:7f00:1 になる）
        'http://[::ffff:127.0.0.1]/x',
        'http://[::ffff:169.254.169.254]/latest/meta-data/',
        'http://[::ffff:a9fe:a9fe]/latest/meta-data/',
        'http://[0:0:0:0:0:ffff:10.0.0.1]/x',
        'http://[::127.0.0.1]/x', // IPv4 互換
        'http://[64:ff9b::7f00:1]/x', // NAT64
        'http://[2002:7f00:1::]/x', // 6to4
        'http://[fe80::1%25eth0]/x', // zone 付き link-local
        'http://2130706433/x', // 10 進表記の 127.0.0.1
        'http://0x7f.1/x', // 16 進・省略表記
        'http://0/x',
        'http://198.18.0.1/x', // ベンチマーク用
        'http://255.255.255.255/x',
    ];
    const allowed = [
        'https://8.8.8.8/x', // 公開 IPv4
        'https://[2606:4700:4700::1111]/x', // 公開 IPv6
        'https://[::ffff:8.8.8.8]/x', // 公開 IPv4 の射影
    ];

    for (const url of blocked) {
        it(`ブロック: ${url}`, async () => {
            await expect(assertPublicUrl(url)).rejects.toThrow();
        });
    }
    for (const url of allowed) {
        it(`許可: ${url}`, async () => {
            await expect(assertPublicUrl(url)).resolves.toBeUndefined();
        });
    }

    it('不正な URL は throw する', async () => {
        await expect(assertPublicUrl('not a url')).rejects.toThrow();
    });
});

describe('isNonPublicIP', () => {
    it('IP として読めない値は拒否する', () => {
        expect(isNonPublicIP('')).toBe(true);
        expect(isNonPublicIP('example.com')).toBe(true);
        expect(isNonPublicIP('127.1')).toBe(true);
    });
});

describe('createPublicOnlyLookup（接続時の DNS 解決）', () => {
    const resolveTo =
        (addresses: dns.LookupAddress[]) =>
        (
            _host: string,
            _opts: dns.LookupAllOptions,
            cb: (e: NodeJS.ErrnoException | null, a: dns.LookupAddress[]) => void,
        ) =>
            cb(null, addresses);

    const lookup = (addresses: dns.LookupAddress[], all: boolean) =>
        new Promise<{ err: NodeJS.ErrnoException | null; address: unknown }>((resolve) =>
            createPublicOnlyLookup(resolveTo(addresses))('rebind.example', { all }, (err, address) =>
                resolve({ err, address }),
            ),
        );

    it('公開アドレスだけなら接続に使う', async () => {
        const result = await lookup([{ address: '93.184.216.34', family: 4 }], false);
        expect(result.err).toBeNull();
        expect(result.address).toBe('93.184.216.34');
    });

    it('検証のあとで内部 IP に解決し直されても（リバインディング）接続させない', async () => {
        const result = await lookup([{ address: '127.0.0.1', family: 4 }], false);
        expect(result.err?.code).toBe('ENOTPUBLIC');
    });

    it('公開と内部が混ざっていれば、公開側を選ばずに丸ごと拒否する', async () => {
        const result = await lookup(
            [
                { address: '93.184.216.34', family: 4 },
                { address: '::ffff:a9fe:a9fe', family: 6 },
            ],
            true,
        );
        expect(result.err?.code).toBe('ENOTPUBLIC');
    });
});

describe('safeFetch', () => {
    const hits: string[] = [];
    const server = http.createServer((req, res) => {
        hits.push(`${req.url} auth=${req.headers.authorization ?? ''}`);
        if (req.url === '/big') {
            res.writeHead(200, { 'content-type': 'text/plain' });
            res.end('x'.repeat(4096));
        } else if (req.url === '/redirect-same') {
            res.writeHead(302, { location: '/echo' });
            res.end();
        } else if (req.url === '/redirect-other') {
            // localhost と 127.0.0.1 は別オリジン
            const port = (server.address() as AddressInfo).port;
            res.writeHead(302, { location: `http://localhost:${port}/echo` });
            res.end();
        } else if (req.url === '/redirect-loop') {
            res.writeHead(302, { location: '/redirect-loop' });
            res.end();
        } else {
            res.writeHead(200, { 'content-type': 'text/plain' });
            res.end('ok');
        }
    });
    const base = () => `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    beforeAll(() => new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve)));
    afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

    it('内部アドレスには 1 回も接続しない（IPv4 射影の書き方でも）', async () => {
        hits.length = 0;
        const port = (server.address() as AddressInfo).port;
        await expect(safeFetch(`http://[::ffff:127.0.0.1]:${port}/x`)).rejects.toThrow();
        await expect(safeFetch(`${base()}/x`)).rejects.toThrow();
        expect(hits).toEqual([]);
    });

    describe('内部アドレスを許す開発設定で、上限とヘッダーの扱いを確かめる', () => {
        const load = async () => {
            vi.resetModules();
            vi.stubEnv('WORLDS_FETCH_ALLOW_PRIVATE', 'true');
            const mod = await import('./safeFetch');
            vi.unstubAllEnvs();
            return mod.safeFetch;
        };

        it('本文が上限を超えたら読み込みが失敗する', async () => {
            const fetchAllowingPrivate = await load();
            const res = await fetchAllowingPrivate(`${base()}/big`, { maxBytes: 1024 });
            await expect(res.text()).rejects.toThrow();
            const ok = await fetchAllowingPrivate(`${base()}/big`, { maxBytes: 4096 });
            expect(await ok.text()).toHaveLength(4096);
        });

        it('同じオリジンへのリダイレクトでは Authorization を保ち、別オリジンでは外す', async () => {
            const fetchAllowingPrivate = await load();
            hits.length = 0;
            await (
                await fetchAllowingPrivate(`${base()}/redirect-same`, { headers: { Authorization: 'Bearer s' } })
            ).text();
            await (
                await fetchAllowingPrivate(`${base()}/redirect-other`, { headers: { Authorization: 'Bearer s' } })
            ).text();
            expect(hits).toEqual([
                '/redirect-same auth=Bearer s',
                '/echo auth=Bearer s',
                '/redirect-other auth=Bearer s',
                '/echo auth=',
            ]);
        });

        it('リダイレクトの回数に上限がある', async () => {
            const fetchAllowingPrivate = await load();
            await expect(fetchAllowingPrivate(`${base()}/redirect-loop`, { maxRedirects: 2 })).rejects.toThrow(
                'リダイレクトが多すぎます',
            );
        });
    });
});
