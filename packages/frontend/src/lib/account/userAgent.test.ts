import { describe, expect, it } from 'vitest';
import { deviceLabelOf } from './userAgent';

describe('端末の名前', () => {
    it('よくあるブラウザーと OS を読む（Chrome の UA に入る Safari・Edge の UA に入る Chrome に引っ張られない）', () => {
        expect(
            deviceLabelOf(
                'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            ),
        ).toBe('Chrome（macOS）');
        expect(
            deviceLabelOf(
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
            ),
        ).toBe('Edge（Windows）');
        expect(
            deviceLabelOf(
                'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
            ),
        ).toBe('Safari（iOS）');
        expect(deviceLabelOf('Mozilla/5.0 (Android 14; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0')).toBe(
            'Firefox（Android）',
        );
    });

    it('読めないもの・空は「不明な端末」、片方だけ読めればそれだけ', () => {
        expect(deviceLabelOf(null)).toBe('不明な端末');
        expect(deviceLabelOf('')).toBe('不明な端末');
        expect(deviceLabelOf('curl/8.0')).toBe('不明な端末');
        expect(deviceLabelOf('Something (Linux x86_64)')).toBe('Linux');
    });
});
