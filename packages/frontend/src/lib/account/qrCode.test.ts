import { describe, expect, it } from 'vitest';
import { modulesToPath, qrCodePath } from './qrCode';

describe('QR コードの path', () => {
    it('暗いマスだけを、行と列の位置の 1×1 の四角にする', () => {
        expect(
            modulesToPath([
                [true, false],
                [false, true],
            ]),
        ).toBe('M0 0h1v1h-1zM1 1h1v1h-1z');
        expect(modulesToPath([[false]])).toBe('');
    });

    it('認証アプリの URI を、余白 4 マスを含む正方形にする（余白は描かない）', () => {
        const { size, path } = qrCodePath(
            'otpauth://totp/Ubichill:%40alice%40ubi.example?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=Ubichill&algorithm=SHA1&digits=6&period=30',
        );
        expect(size).toBeGreaterThanOrEqual(21 + 8);
        const cells = [...path.matchAll(/M(\d+) (\d+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
        expect(cells.length).toBeGreaterThan(0);
        expect(cells.every(([x = 0, y = 0]) => x >= 4 && y >= 4 && x < size - 4 && y < size - 4)).toBe(true);
    });
});
