import { describe, expect, it } from 'vitest';
import { base32Encode, hotp, matchTotp, otpauthUri, totpStep } from './totp';

// RFC 4226・RFC 6238 の付録の鍵（ASCII の "12345678901234567890"）
const RFC_SECRET = new TextEncoder().encode('12345678901234567890');
const at = (seconds: number) => new Date(seconds * 1000);

describe('TOTP', () => {
    it('base32 は RFC 4648 の例と同じ（= の詰め物は付けない）', () => {
        const cases: Array<[string, string]> = [
            ['', ''],
            ['f', 'MY'],
            ['fo', 'MZXQ'],
            ['foo', 'MZXW6'],
            ['foob', 'MZXW6YQ'],
            ['fooba', 'MZXW6YTB'],
            ['foobar', 'MZXW6YTBOI'],
        ];
        for (const [plain, encoded] of cases) expect(base32Encode(new TextEncoder().encode(plain))).toBe(encoded);
    });

    it('HOTP は RFC 4226 の付録の値と同じ', () => {
        const expected = [
            '755224',
            '287082',
            '359152',
            '969429',
            '338314',
            '254676',
            '287922',
            '162583',
            '399871',
            '520489',
        ];
        expect(expected.map((_, counter) => hotp(RFC_SECRET, counter))).toEqual(expected);
    });

    it('TOTP は RFC 6238 の付録の値（SHA-1、下 6 桁）と同じ', () => {
        const cases: Array<[number, string]> = [
            [59, '287082'],
            [1111111109, '081804'],
            [1111111111, '050471'],
            [1234567890, '005924'],
            [2000000000, '279037'],
            [20000000000, '353130'],
        ];
        for (const [seconds, code] of cases) {
            expect(hotp(RFC_SECRET, totpStep(at(seconds)))).toBe(code);
            expect(matchTotp(RFC_SECRET, code, at(seconds), null)).toBe(totpStep(at(seconds)));
        }
    });

    it('前後 30 秒のずれは許し、それより外は断る', () => {
        const now = at(1234567890);
        const step = totpStep(now);
        expect(matchTotp(RFC_SECRET, hotp(RFC_SECRET, step - 1), now, null)).toBe(step - 1);
        expect(matchTotp(RFC_SECRET, hotp(RFC_SECRET, step + 1), now, null)).toBe(step + 1);
        expect(matchTotp(RFC_SECRET, hotp(RFC_SECRET, step - 2), now, null)).toBeNull();
        expect(matchTotp(RFC_SECRET, hotp(RFC_SECRET, step + 2), now, null)).toBeNull();
    });

    it('一度使った区切りとそれより前のコードは受け付けない（見られたコードの使い回しを防ぐ）', () => {
        const now = at(1234567890);
        const step = totpStep(now);
        const code = hotp(RFC_SECRET, step);
        expect(matchTotp(RFC_SECRET, code, now, step)).toBeNull();
        expect(matchTotp(RFC_SECRET, hotp(RFC_SECRET, step - 1), now, step - 1)).toBeNull();
        // 先の区切りのコードはまだ使える
        expect(matchTotp(RFC_SECRET, hotp(RFC_SECRET, step + 1), now, step)).toBe(step + 1);
    });

    it('6 桁の数字でなければ確かめない（空・空白・桁違い・全角）', () => {
        const now = at(59);
        for (const code of ['', ' 287082', '28708', '2870820', '２８７０８２', '287O82']) {
            expect(matchTotp(RFC_SECRET, code, now, null)).toBeNull();
        }
    });

    it('otpauth の URI に鍵・発行者・桁・周期を入れ、名前は URL エンコードする', () => {
        const uri = otpauthUri({ secret: RFC_SECRET, issuer: 'Ubichill', account: '@alice@ubi.example' });
        const url = new URL(uri);
        expect(url.protocol).toBe('otpauth:');
        expect(uri.startsWith('otpauth://totp/Ubichill:%40alice%40ubi.example?')).toBe(true);
        expect(Object.fromEntries(url.searchParams)).toEqual({
            secret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
            issuer: 'Ubichill',
            algorithm: 'SHA1',
            digits: '6',
            period: '30',
        });
    });
});
