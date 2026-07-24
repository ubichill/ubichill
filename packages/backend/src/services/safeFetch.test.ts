import { describe, expect, it } from 'vitest';
import { assertPublicUrl } from './safeFetch';

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
    ];
    const allowed = [
        'https://8.8.8.8/x', // 公開 IPv4
        'https://[2606:4700:4700::1111]/x', // 公開 IPv6
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
