import { describe, expect, it } from 'vitest';
import {
    contrastRatio,
    contrastWithButtonText,
    DEFAULT_THEME_PRIMARY,
    MIN_THEME_CONTRAST,
    normalizeHexColor,
    parseHexColor,
    themeColorProblem,
    themeCssVariables,
    themePalette,
    themeStyleSheet,
} from './themeColor';

const rgbOf = (hex: string) => {
    const rgb = parseHexColor(hex);
    if (!rgb) throw new Error(hex);
    return rgb;
};

describe('normalizeHexColor', () => {
    it('#rgb・大文字・前後の空白を #rrggbb の小文字にする', () => {
        expect(normalizeHexColor('#ABC')).toBe('#aabbcc');
        expect(normalizeHexColor('  #1B2A44 ')).toBe('#1b2a44');
    });

    it.each([
        'red',
        '1b2a44',
        '#12345',
        '#1234567',
        '#ggg',
        '',
        'rgb(0, 0, 0)',
        '#000000;}</style><script>',
        '#000\n#fff',
    ])('%j は色にしない', (value) => {
        expect(normalizeHexColor(value)).toBeNull();
        expect(themeColorProblem(value)).toMatch(/16 進数/);
    });
});

describe('contrastRatio', () => {
    it('黒と白は 21、同じ色は 1、順序によらない', () => {
        const black = rgbOf('#000000');
        const white = rgbOf('#ffffff');
        expect(contrastRatio(black, white)).toBeCloseTo(21, 5);
        expect(contrastRatio(white, black)).toBeCloseTo(21, 5);
        expect(contrastRatio(white, white)).toBe(1);
    });
});

describe('themeColorProblem', () => {
    it('既定の色は使える', () => {
        expect(themeColorProblem(DEFAULT_THEME_PRIMARY)).toBeNull();
    });

    it('明るい色は、ボタンの文字が読めないので断り、比と要る値を伝える', () => {
        expect(themeColorProblem('#ffffff')).toMatch(/コントラスト比 1\.\d\d。4\.5 以上/);
        expect(themeColorProblem('#808080')).toMatch(/明るすぎ/);
    });

    it('境目のすぐ下（4.4999…）は断り、4.50 と丸めて見せない', () => {
        expect(contrastWithButtonText(rgbOf('#844bee'))).toBeLessThan(MIN_THEME_CONTRAST);
        const problem = themeColorProblem('#844bee');
        expect(problem).toContain('4.49');
        expect(problem).not.toContain('4.50');
    });

    it('境目のすぐ上は使える', () => {
        expect(contrastWithButtonText(rgbOf('#6f6f6f'))).toBeGreaterThanOrEqual(MIN_THEME_CONTRAST);
        expect(themeColorProblem('#6f6f6f')).toBeNull();
        expect(themeColorProblem('#707070')).not.toBeNull();
    });
});

describe('themePalette', () => {
    it('色でなければ null', () => {
        expect(themePalette('navy')).toBeNull();
    });

    it('既定の色からは、今のトークンに近い色の組を作る', () => {
        const palette = themePalette('#1B2A44');
        expect(palette).toMatchObject({
            primary: '#1b2a44',
            primarySubtle: 'rgba(27, 42, 68, 0.15)',
            chipBgActive: 'rgba(27, 42, 68, 0.8)',
        });
        // 押したときは明るく（既定のトークンも明るくしている）
        const lightness = (hex: string) => {
            const { r, g, b } = rgbOf(hex);
            return Math.max(r, g, b) + Math.min(r, g, b);
        };
        expect(lightness(palette?.primaryHover ?? '')).toBeGreaterThan(lightness('#1b2a44'));
        expect(lightness(palette?.primaryActive ?? '')).toBeGreaterThan(lightness(palette?.primaryHover ?? ''));
        // フォーカスの輪は同じ青系の明るい色（トークンは #4780e0）
        const highlight = rgbOf(palette?.primaryHighlight ?? '');
        expect(highlight.b).toBeGreaterThan(highlight.r);
        expect(contrastRatio(highlight, rgbOf('#4780e0'))).toBeLessThan(1.1);
    });

    it('使える色なら、押したとき・押している間の色もボタンの文字が読める（境目に近い色は暗くする）', () => {
        const steps = [0, 37, 74, 111, 148, 185, 222, 255];
        const accepted = steps
            .flatMap((r) =>
                steps.flatMap((g) =>
                    steps.map((b) => `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`),
                ),
            )
            .concat(['#6f6f6f', '#427d38', '#2f6f4f'])
            .filter((hex) => themeColorProblem(hex) === null);
        expect(accepted.length).toBeGreaterThan(50);
        for (const hex of accepted) {
            const palette = themePalette(hex);
            expect(contrastWithButtonText(rgbOf(palette?.primaryHover ?? '')), hex).toBeGreaterThanOrEqual(
                MIN_THEME_CONTRAST,
            );
            expect(contrastWithButtonText(rgbOf(palette?.primaryActive ?? '')), hex).toBeGreaterThanOrEqual(
                MIN_THEME_CONTRAST,
            );
            expect(palette?.primaryHover, hex).not.toBe(palette?.primary);
        }
    });

    it('灰色・黒のフォーカスの輪に色を付けない（彩度を足すと赤になる）', () => {
        for (const hex of ['#000000', '#333333', '#6f6f6f']) {
            const { r, g, b } = rgbOf(themePalette(hex)?.primaryHighlight ?? '');
            expect(r, hex).toBe(g);
            expect(g, hex).toBe(b);
        }
    });

    it('どの主な色でも、フォーカスの輪は暗い背景の上で見える明るさにする', () => {
        for (const hex of ['#000000', '#1b2a44', '#550000', '#003300', '#2f6f4f']) {
            const highlight = rgbOf(themePalette(hex)?.primaryHighlight ?? '');
            expect(contrastRatio(highlight, rgbOf('#0f0f14')), hex).toBeGreaterThan(4);
        }
    });
});

describe('themeCssVariables / themeStyleSheet', () => {
    it('トークン名を PandaCSS の CSS 変数名にする', () => {
        const vars = themeCssVariables('#1b2a44');
        expect(vars['--colors-primary']).toBe('#1b2a44');
        expect(Object.keys(vars)).toEqual(
            expect.arrayContaining(['--colors-primary-hover', '--colors-primary-highlight', '--colors-chip-bg-active']),
        );
    });

    it('色でなければ何も上書きしない', () => {
        expect(themeCssVariables('</style>')).toEqual({});
        expect(themeStyleSheet('</style>')).toBe('');
    });

    it('`<style>` に入れる文字列は、色と変数名の文字しか含まない', () => {
        const sheet = themeStyleSheet('#2F6F4F');
        expect(sheet).toMatch(/^:root\{[-a-z0-9:#;(), .]+\}$/);
        expect(sheet).toContain('--colors-primary:#2f6f4f');
    });
});
