import { DEFAULT_SERVER_BRANDING } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import { brandingChanged, brandingDraft, checkThemeColor } from './brandingForm';

describe('brandingChanged', () => {
    const saved = { ...DEFAULT_SERVER_BRANDING, shortName: 'ゆ', themeColor: '#1b2a44' };

    it('前後の空白・色の書き方の違いだけなら変えていない', () => {
        expect(brandingChanged(saved, brandingDraft(saved))).toBe(false);
        expect(brandingChanged(saved, { shortName: ' ゆ ', themeColor: ' #1B2A44' })).toBe(false);
        expect(brandingChanged({ ...saved, themeColor: '#aabbcc' }, { shortName: 'ゆ', themeColor: '#ABC' })).toBe(
            false,
        );
    });

    it('空にする（既定に戻す）のは変えたことになる', () => {
        expect(brandingChanged(saved, { shortName: '', themeColor: '#1b2a44' })).toBe(true);
        expect(brandingChanged(saved, { shortName: 'ゆ', themeColor: '' })).toBe(true);
        expect(brandingChanged(DEFAULT_SERVER_BRANDING, { shortName: '', themeColor: '' })).toBe(false);
    });

    it('打ちかけの色（まだ色でない）も変えたことになる（保存すると理由が出る）', () => {
        expect(brandingChanged(saved, { shortName: 'ゆ', themeColor: '#1b2a4' })).toBe(true);
    });
});

describe('checkThemeColor', () => {
    it('空は既定の色', () => {
        expect(checkThemeColor('  ')).toEqual({ state: 'default' });
    });

    it('色でなければ理由だけ', () => {
        expect(checkThemeColor('navy')).toMatchObject({ state: 'invalid', problem: expect.stringMatching(/16 進数/) });
    });

    it('読める色は見本の色とコントラスト比を返す', () => {
        const check = checkThemeColor('#1B2A44');
        expect(check).toMatchObject({ state: 'ok', color: '#1b2a44', problem: null });
        expect(check.state === 'ok' && check.ratio).toBeGreaterThan(10);
    });

    it('明るすぎる色は見本を出しつつ、保存できない理由を返す', () => {
        expect(checkThemeColor('#ffcc00')).toMatchObject({
            state: 'low-contrast',
            color: '#ffcc00',
            problem: expect.stringMatching(/明るすぎ/),
        });
    });
});
