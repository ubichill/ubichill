import { describe, expect, it } from 'vitest';
import { devOrigins, devUrls, lanAddresses, listenHost, parseHostOption } from './address.ts';

const interfaces = {
    lo0: [
        { address: '127.0.0.1', family: 'IPv4', internal: true },
        { address: '::1', family: 'IPv6', internal: true },
    ],
    en0: [
        { address: '192.168.1.10', family: 'IPv4', internal: false },
        { address: 'fe80::1', family: 'IPv6', internal: false },
    ],
    // 古い Node は family を数で返す
    en1: [{ address: '10.0.0.5', family: 4, internal: false }],
    bridge: [{ address: '192.168.1.10', family: 'IPv4', internal: false }],
    down: undefined,
};

describe('parseHostOption', () => {
    it('指定が無ければ手元だけ（Vite と同じ。LAN に勝手に出さない）', () => {
        expect(parseHostOption([])).toEqual({ kind: 'loopback' });
        expect(parseHostOption(['world.yaml', '--port=4000'])).toEqual({ kind: 'loopback' });
    });

    it('--host・--host=・0.0.0.0・:: は全部の口', () => {
        for (const argv of [['--host'], ['--host='], ['--host=0.0.0.0'], ['--host=::'], ['--host=[::]']]) {
            expect(parseHostOption(argv)).toEqual({ kind: 'all' });
        }
    });

    it('--host=<addr> はその口だけ（IPv6 の角括弧は外す）', () => {
        expect(parseHostOption(['--host=192.168.1.10'])).toEqual({ kind: 'address', host: '192.168.1.10' });
        expect(parseHostOption(['--host=[fe80::1]'])).toEqual({ kind: 'address', host: 'fe80::1' });
    });
});

describe('listenHost', () => {
    it('手元だけは 127.0.0.1、全部の口は Node の既定（undefined）、指定はそのまま', () => {
        expect(listenHost({ kind: 'loopback' })).toBe('127.0.0.1');
        expect(listenHost({ kind: 'all' })).toBeUndefined();
        expect(listenHost({ kind: 'address', host: '192.168.1.10' })).toBe('192.168.1.10');
    });
});

describe('lanAddresses', () => {
    it('loopback と IPv6 を除き、同じアドレスは 1 つにする', () => {
        expect(lanAddresses(interfaces)).toEqual(['192.168.1.10', '10.0.0.5']);
    });
});

describe('devUrls / devOrigins', () => {
    it('手元だけ: Local だけで、Go には localhost と 127.0.0.1 を許す', () => {
        const urls = devUrls({ kind: 'loopback' }, 3333, interfaces);
        expect(urls).toEqual({ local: 'http://localhost:3333/', network: [] });
        expect(devOrigins(urls, 3333)).toEqual(['http://localhost:3333', 'http://127.0.0.1:3333']);
    });

    it('全部の口: LAN の URL を並べ、そのオリジンも Go に許す', () => {
        const urls = devUrls({ kind: 'all' }, 3333, interfaces);
        expect(urls.network).toEqual(['http://192.168.1.10:3333/', 'http://10.0.0.5:3333/']);
        expect(devOrigins(urls, 3333)).toEqual([
            'http://localhost:3333',
            'http://127.0.0.1:3333',
            'http://192.168.1.10:3333',
            'http://10.0.0.5:3333',
        ]);
    });

    it('特定の LAN の口だけで待つときは localhost では開けないので Local を出さない', () => {
        const urls = devUrls({ kind: 'address', host: '192.168.1.10' }, 3333, interfaces);
        expect(urls).toEqual({ network: ['http://192.168.1.10:3333/'] });
    });

    it('IPv6 のアドレスは URL で角括弧に入れる', () => {
        const urls = devUrls({ kind: 'address', host: 'fe80::1' }, 3333, interfaces);
        expect(urls.network).toEqual(['http://[fe80::1]:3333/']);
        expect(devOrigins(urls, 3333)).toContain('http://[fe80::1]:3333');
    });

    it('loopback を明示したときは LAN に出さない', () => {
        expect(devUrls({ kind: 'address', host: '127.0.0.1' }, 3333, interfaces)).toEqual({
            local: 'http://localhost:3333/',
            network: [],
        });
        expect(devUrls({ kind: 'address', host: '::1' }, 3333, interfaces).local).toBe('http://[::1]:3333/');
    });

    it('LAN の口が無い機械でも全部の口で起動できる（Network が空）', () => {
        expect(devUrls({ kind: 'all' }, 3333, {}).network).toEqual([]);
    });
});
