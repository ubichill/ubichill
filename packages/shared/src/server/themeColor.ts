/**
 * テーマの色（コントロールパネルの「ブランディング」）。管理者が決めるのは主な色（ボタンなど）だけで、
 * 押したときの色・フォーカスの輪の色・半透明の色はここで主な色から作る。
 * 画面（PandaCSS のトークン）の既定の値もここから取る（panda.config.ts）。
 */

export interface Rgb {
    r: number;
    g: number;
    b: number;
}

interface Hsl {
    h: number;
    s: number;
    l: number;
}

/** 既定の主な色（トークン colors.primary） */
export const DEFAULT_THEME_PRIMARY = '#1b2a44';
/** 主な色のボタンの上の文字の色（トークン colors.textOnPrimary）。テーマの色を変えてもこれは変えない */
export const THEME_TEXT_ON_PRIMARY = '#f8f3ea';
/** ボタンの文字が読めるのに要るコントラスト比（WCAG 2.x AA・通常の文字） */
export const MIN_THEME_CONTRAST = 4.5;

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** `#rgb`・`#rrggbb`（大文字も可）を `#rrggbb` の小文字にする。色でなければ null。 */
export function normalizeHexColor(value: string): string | null {
    const trimmed = value.trim();
    if (!HEX.test(trimmed)) return null;
    const digits = trimmed.slice(1).toLowerCase();
    return `#${digits.length === 3 ? [...digits].map((d) => d + d).join('') : digits}`;
}

export function parseHexColor(value: string): Rgb | null {
    const hex = normalizeHexColor(value);
    if (!hex) return null;
    const n = Number.parseInt(hex.slice(1), 16);
    return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}

export const toHexColor = ({ r, g, b }: Rgb): string =>
    `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;

/** WCAG 2.x の相対輝度 */
export function relativeLuminance({ r, g, b }: Rgb): number {
    const linear = (c: number) => {
        const v = c / 255;
        return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** 2 色のコントラスト比（1〜21） */
export function contrastRatio(a: Rgb, b: Rgb): number {
    const [light, dark] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
    return (light + 0.05) / (dark + 0.05);
}

const TEXT_ON_PRIMARY = parseHexColor(THEME_TEXT_ON_PRIMARY) as Rgb;

/** 主な色のボタンの文字とのコントラスト比 */
export const contrastWithButtonText = (color: Rgb): number => contrastRatio(color, TEXT_ON_PRIMARY);

/** テーマの色として使えないなら、その理由（使えるなら null）。 */
export function themeColorProblem(value: string): string | null {
    const color = parseHexColor(value);
    if (!color) return '色は #1b2a44 のような 16 進数で入れてください';
    const ratio = contrastWithButtonText(color);
    if (ratio < MIN_THEME_CONTRAST) {
        return `この色は明るすぎて、ボタンの文字が読みにくくなります（コントラスト比 ${formatContrastRatio(ratio)}。${MIN_THEME_CONTRAST} 以上が要ります）。もっと暗い色にしてください`;
    }
    return null;
}

/** コントラスト比を小数 2 桁で見せる。切り捨てる（4.499 を 4.50 と出して「足りているのに断られた」と見せない） */
export const formatContrastRatio = (ratio: number): string => (Math.floor(ratio * 100) / 100).toFixed(2);

function rgbToHsl({ r, g, b }: Rgb): Hsl {
    const [rn, gn, bn] = [r / 255, g / 255, b / 255];
    const max = Math.max(rn, gn, bn);
    const min = Math.min(rn, gn, bn);
    const l = (max + min) / 2;
    const d = max - min;
    if (d === 0) return { h: 0, s: 0, l };
    const s = d / (1 - Math.abs(2 * l - 1));
    const h =
        max === rn ? 60 * (((gn - bn) / d + 6) % 6) : max === gn ? 60 * ((bn - rn) / d + 2) : 60 * ((rn - gn) / d + 4);
    return { h, s, l };
}

function hslToRgb({ h, s, l }: Hsl): Rgb {
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    const sector = Math.floor(h / 60) % 6;
    const [r, g, b] = [
        [c, x, 0],
        [x, c, 0],
        [0, c, x],
        [0, x, c],
        [x, 0, c],
        [c, 0, x],
    ][sector] as [number, number, number];
    return { r: Math.round((r + m) * 255), g: Math.round((g + m) * 255), b: Math.round((b + m) * 255) };
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/**
 * 押したとき・押している間の色。既定の色と同じく明るくするが、明るくして文字が読めなくなる色（境目に近い色）は暗くする
 * （同じ色相・彩度で暗くすれば、コントラストは必ず上がる）。
 */
function shade(base: Hsl, delta: number): Rgb {
    const lighter = hslToRgb({ ...base, l: clamp01(base.l + delta) });
    return contrastWithButtonText(lighter) >= MIN_THEME_CONTRAST
        ? lighter
        : hslToRgb({ ...base, l: clamp01(base.l - delta) });
}

/**
 * フォーカスの輪・暗い背景の上の線に使う明るい色。明るさを決めた値にそろえ、どの主な色でも暗いワールドの上で見えるようにする。
 * 無彩色（灰色・黒）に彩度を足すと赤になってしまうので、彩度の低い色は彩度を変えない。
 */
function highlight(base: Hsl): Rgb {
    return hslToRgb({ h: base.h, s: base.s < 0.08 ? base.s : Math.max(base.s, 0.7), l: 0.58 });
}

const rgba = ({ r, g, b }: Rgb, alpha: number): string => `rgba(${r}, ${g}, ${b}, ${alpha})`;

/** 主な色から作る色の組（キーは PandaCSS のトークン名） */
export interface ThemePalette {
    primary: string;
    primaryHover: string;
    primaryActive: string;
    primaryHighlight: string;
    primarySubtle: string;
    selectionDashed: string;
    chipBg: string;
    chipBgActive: string;
    chipLabelBg: string;
    bannerShade: string;
}

/** 主な色から色の組を作る。色として読めなければ null。 */
export function themePalette(primary: string): ThemePalette | null {
    const rgb = parseHexColor(primary);
    if (!rgb) return null;
    const hsl = rgbToHsl(rgb);
    return {
        primary: toHexColor(rgb),
        primaryHover: toHexColor(shade(hsl, 0.04)),
        primaryActive: toHexColor(shade(hsl, 0.09)),
        primaryHighlight: toHexColor(highlight(hsl)),
        primarySubtle: rgba(rgb, 0.15),
        selectionDashed: rgba(rgb, 0.5),
        chipBg: rgba(rgb, 0.5),
        chipBgActive: rgba(rgb, 0.8),
        chipLabelBg: rgba(rgb, 0.7),
        bannerShade: rgba(rgb, 0.85),
    };
}

/** PandaCSS のトークン名（`primaryHover`）→ CSS 変数名（`--colors-primary-hover`） */
const cssVariableOf = (token: string): string => `--colors-${token.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;

/** 画面のトークンを上書きする CSS 変数。色として読めなければ空（既定の色のまま）。 */
export function themeCssVariables(primary: string): Record<string, string> {
    const palette = themePalette(primary);
    return palette
        ? Object.fromEntries(Object.entries(palette).map(([token, value]) => [cssVariableOf(token), value]))
        : {};
}

/** テーマの色を入れる `<style>` の id（BFF が HTML に入れ、画面が書き換える） */
export const THEME_STYLE_ELEMENT_ID = 'ubichill-theme';

/** `<style>` にそのまま入れられる `:root{...}`。値は themePalette が作った色だけなので、HTML・CSS を壊す文字は入らない。 */
export function themeStyleSheet(primary: string): string {
    const declarations = Object.entries(themeCssVariables(primary))
        .map(([name, value]) => `${name}:${value}`)
        .join(';');
    return declarations ? `:root{${declarations}}` : '';
}
