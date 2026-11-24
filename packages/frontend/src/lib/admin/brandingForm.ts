import {
    contrastWithButtonText,
    normalizeHexColor,
    parseHexColor,
    type ServerBranding,
    themeColorProblem,
} from '@ubichill/shared';

/** 入力欄の中身（決めていない欄は ''）。 */
export interface BrandingDraft {
    shortName: string;
    themeColor: string;
}

export const brandingDraft = (branding: ServerBranding): BrandingDraft => ({
    shortName: branding.shortName ?? '',
    themeColor: branding.themeColor ?? '',
});

/** 保存したものから変えたか（前後の空白・色の大文字小文字・#rgb の書き方だけの違いは変えていない扱い） */
export function brandingChanged(branding: ServerBranding, draft: BrandingDraft): boolean {
    const color = draft.themeColor.trim();
    return (
        (branding.shortName ?? '') !== draft.shortName.trim() ||
        (branding.themeColor ?? '') !== (normalizeHexColor(color) ?? color)
    );
}

export type ThemeColorCheck =
    | { state: 'default' }
    | { state: 'invalid'; problem: string }
    | { state: 'ok' | 'low-contrast'; color: string; ratio: number; problem: string | null };

/** 入れた色の見本と、ボタンの文字とのコントラスト（保存の前に、サーバーと同じ規則で確かめる）。 */
export function checkThemeColor(value: string): ThemeColorCheck {
    if (value.trim() === '') return { state: 'default' };
    const rgb = parseHexColor(value);
    const color = normalizeHexColor(value);
    const problem = themeColorProblem(value);
    if (!rgb || !color) return { state: 'invalid', problem: problem ?? '' };
    return { state: problem ? 'low-contrast' : 'ok', color, ratio: contrastWithButtonText(rgb), problem };
}
