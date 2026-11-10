/**
 * 絵文字を選ぶ画面の純粋な規則（データの形・検索・最近使ったもの）。
 * データは emojiData.json（scripts/generate-emoji-data.mjs が作る）を遅延読み込みで読み、ここでは形だけを扱う。
 */
import { isSingleEmoji } from '@ubichill/shared';

/** emojiData.json の 1 つ: [絵文字, 日本語の名前, 日本語の語, 英語の名前と語] */
export type RawEmoji = readonly string[];

export interface RawEmojiData {
    groups: ReadonlyArray<{ key: string; label: string; emojis: readonly RawEmoji[] }>;
}

export interface EmojiEntry {
    emoji: string;
    /** 日本語の名前（ボタンの読み上げの名前） */
    name: string;
    /** 検索に使う語（fold 済み） */
    terms: readonly string[];
}

export interface EmojiGroup {
    key: string;
    label: string;
    emojis: readonly EmojiEntry[];
}

export const RECENT_EMOJI_MAX = 32;
export const SEARCH_RESULT_MAX = 120;

/**
 * 検索で比べる形: 全角半角をそろえ（NFKC）、小文字にし、カタカナをひらがなにする（「ネコ」でも「ねこ」でも引ける）。
 */
export const foldForSearch = (value: string): string =>
    value
        .normalize('NFKC')
        .toLowerCase()
        .replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60))
        .trim();

const termsOf = (raw: RawEmoji): string[] => [
    foldForSearch(raw[1] ?? ''),
    ...`${raw[2] ?? ''} ${raw[3] ?? ''}`.split(/\s+/).filter(Boolean).map(foldForSearch),
];

export const emojiGroupsOf = (data: RawEmojiData): EmojiGroup[] =>
    data.groups.map((g) => ({
        key: g.key,
        label: g.label,
        emojis: g.emojis.flatMap((raw) => {
            const [emoji, name] = raw;
            return emoji && name ? [{ emoji, name, terms: termsOf(raw) }] : [];
        }),
    }));

/** 一致の強さ（小さいほど前）。名前と同じ → 名前の頭 → 語と同じ → 語の頭 → 語の途中。合わなければ undefined。 */
function matchRank(entry: EmojiEntry, word: string): number | undefined {
    const [name = '', ...rest] = entry.terms;
    if (name === word) return 0;
    if (name.startsWith(word)) return 1;
    if (rest.includes(word)) return 2;
    if (rest.some((t) => t.startsWith(word))) return 3;
    if (entry.terms.some((t) => t.includes(word))) return 4;
    return undefined;
}

/**
 * 空白で区切った語がどれも合うものを、一致の強い順（同じなら元の並び）に返す。
 * 絵文字そのもので引いたときはその絵文字だけを返す（貼り付けて探す）。
 */
export function searchEmojis(groups: readonly EmojiGroup[], query: string, max = SEARCH_RESULT_MAX): EmojiEntry[] {
    const words = foldForSearch(query).split(/\s+/).filter(Boolean);
    if (words.length === 0) return [];
    const all = groups.flatMap((g) => g.emojis);
    const exact = all.filter((e) => e.emoji === query.trim());
    if (exact.length > 0) return exact;
    return all
        .flatMap((entry, order) => {
            const ranks = words.map((w) => matchRank(entry, w));
            if (ranks.some((r) => r === undefined)) return [];
            return [{ entry, order, rank: Math.max(...(ranks as number[])) }];
        })
        .toSorted((a, b) => a.rank - b.rank || a.order - b.order)
        .slice(0, max)
        .map((m) => m.entry);
}

/** 最近使ったもの: 使ったものを頭に足し、重ねず、上限で切る。 */
export const withRecentEmoji = (recent: readonly string[], emoji: string, max = RECENT_EMOJI_MAX): string[] =>
    [emoji, ...recent.filter((e) => e !== emoji)].slice(0, max);

/** 保存してあった最近使ったもの（JSON を読んだ値）を確かめる。配列でない・絵文字でないもの・重なりは捨てる。 */
export function recentEmojisOf(value: unknown, max = RECENT_EMOJI_MAX): string[] {
    if (!Array.isArray(value)) return [];
    const emojis = value.filter((v): v is string => typeof v === 'string' && isSingleEmoji(v));
    return [...new Set(emojis)].slice(0, max);
}

/** 最近使ったものを、名前つきの項目にする（データに無いものは名前なしで出す）。 */
export function recentEntries(groups: readonly EmojiGroup[], recent: readonly string[]): EmojiEntry[] {
    const byEmoji = new Map(groups.flatMap((g) => g.emojis).map((e) => [e.emoji, e]));
    return recent.map((emoji) => byEmoji.get(emoji) ?? { emoji, name: emoji, terms: [] });
}

const isLowSurrogate = (code: number): boolean => code >= 0xdc00 && code <= 0xdfff;

/** サロゲートペアの間に落ちた位置を後ろへずらす（絵文字を半分に割らない）。 */
const snapToCodePoint = (value: string, index: number): number =>
    index > 0 && index < value.length && isLowSurrogate(value.charCodeAt(index)) ? index + 1 : index;

/** 入力欄の選んでいる範囲を text に置き換え、置いたあとのカーソルの位置を返す。範囲が無ければ末尾に足す。 */
export function insertAtSelection(
    value: string,
    selection: { start: number; end: number } | null,
    text: string,
): { value: string; caret: number } {
    const clamp = (n: number) => snapToCodePoint(value, Math.min(Math.max(0, Math.trunc(n) || 0), value.length));
    const start = selection ? clamp(selection.start) : value.length;
    const end = selection ? Math.max(start, clamp(selection.end)) : value.length;
    return { value: `${value.slice(0, start)}${text}${value.slice(end)}`, caret: start + text.length };
}
