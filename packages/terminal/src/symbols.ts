/**
 * 行の頭の記号。絵文字は使わない（端末・フォントで幅や色が変わる）。
 * 注意の記号を ▲ ⚠ にしないのは、▲ は East Asian Width が Ambiguous で日本語の設定の端末では 2 桁になり、⚠ は絵文字で描かれるため。
 */
export interface Symbols {
    readonly success: string;
    readonly error: string;
    readonly warn: string;
    readonly arrow: string;
}

export const UNICODE_SYMBOLS: Symbols = { success: '✓', error: '✗', warn: '!', arrow: '➜' };

/** Unicode を描けない端末向け（Windows の conhost でも出る文字）。 */
export const FALLBACK_SYMBOLS: Symbols = { success: '√', error: '×', warn: '!', arrow: '>' };

export const symbolsFor = (unicode: boolean): Symbols => (unicode ? UNICODE_SYMBOLS : FALLBACK_SYMBOLS);
