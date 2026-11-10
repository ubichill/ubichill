/**
 * ほかのサーバーの人の文字（自己紹介・名前・ひとこと・項目）に含まれるリンク・メンション・カスタム絵文字。
 * HTML はそのまま出さず、文字とリンクの並び（{@link RichSegment}）にして持ち、表示はテキストとして行う。
 * HTML から作るのは federation/fediverse/richText.ts。ここは型と、保存したものを確かめ直す処理と、絵文字の切り分け。
 */
import { z } from 'zod';
import { parseFederationUrl } from '../federation/urls';

export type RichSegment =
    | { kind: 'text'; text: string }
    | { kind: 'link'; text: string; href: string }
    /** account は `handle@domain`（読めなければ null で、href を開く） */
    | { kind: 'mention'; text: string; href: string; account: string | null };

/** カスタム絵文字（`:name:` の画像）。 */
export interface CustomEmoji {
    name: string;
    url: string;
}

/** 1 人分に持つカスタム絵文字の数（Misskey・Mastodon は名前と自己紹介に使ったものだけを載せる）。 */
export const MAX_CUSTOM_EMOJIS = 64;
/** 自己紹介の区切りの数 */
export const MAX_RICH_SEGMENTS = 200;
/** リンク・メンションの文字の長さ */
export const RICH_LINK_TEXT_MAX = 200;

export const CUSTOM_EMOJI_NAME = /^[A-Za-z0-9_+-]{1,64}$/;

const httpUrl = (value: string): string | null => parseFederationUrl(value, { allowHttp: true })?.href ?? null;

const clip = (text: string, max: number): string => Array.from(text).slice(0, max).join('');

const StoredSegmentSchema = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('text'), text: z.string() }),
    z.object({ kind: z.literal('link'), text: z.string(), href: z.string() }),
    z.object({ kind: z.literal('mention'), text: z.string(), href: z.string(), account: z.string().nullable() }),
]);

/**
 * 保存した自己紹介の並びを確かめ直す（壊れた区切りは飛ばし、リンクは http(s) だけ、文字は合わせて max 文字まで）。
 * 並びが無い・読めなければ null（自己紹介の文字だけで出す）。
 */
export function storedRichTextOf(stored: unknown, max: number): RichSegment[] | null {
    if (!Array.isArray(stored)) return null;
    const valid = stored.slice(0, MAX_RICH_SEGMENTS).flatMap((item): RichSegment[] => {
        const parsed = StoredSegmentSchema.safeParse(item);
        if (!parsed.success || !parsed.data.text) return [];
        const segment = parsed.data;
        if (segment.kind === 'text') return [segment];
        const href = httpUrl(segment.href);
        const text = clip(segment.text, RICH_LINK_TEXT_MAX);
        if (!href) return [{ kind: 'text', text }];
        return [segment.kind === 'link' ? { kind: 'link', text, href } : { ...segment, text, href }];
    });
    return clipRichText(valid, max);
}

/** 合わせて max 文字までにする（はみ出した区切りは文字を切り、その後ろは捨てる）。 */
export function clipRichText(segments: readonly RichSegment[], max: number): RichSegment[] {
    return segments.reduce<{ out: RichSegment[]; left: number }>(
        (acc, segment) => {
            if (acc.left <= 0) return acc;
            const length = Array.from(segment.text).length;
            const next = length <= acc.left ? segment : { ...segment, text: clip(segment.text, acc.left) };
            return { out: [...acc.out, next], left: acc.left - length };
        },
        { out: [], left: max },
    ).out;
}

/** 区切りをつないだ文字（一覧のカードやリンクのプレビューに使う）。 */
export const richTextPlain = (segments: readonly RichSegment[]): string => segments.map((s) => s.text).join('');

const StoredEmojiSchema = z.object({ name: z.string(), url: z.string() });

/** 保存したカスタム絵文字を確かめ直す（名前の形・http(s) の画像・数）。同じ名前は最初のもの。 */
export function storedCustomEmojisOf(stored: unknown): CustomEmoji[] {
    if (!Array.isArray(stored)) return [];
    const emojis = stored.flatMap((item): CustomEmoji[] => {
        const parsed = StoredEmojiSchema.safeParse(item);
        if (!parsed.success || !CUSTOM_EMOJI_NAME.test(parsed.data.name)) return [];
        const url = httpUrl(parsed.data.url);
        return url ? [{ name: parsed.data.name, url }] : [];
    });
    return emojis.filter((e, i) => emojis.findIndex((f) => f.name === e.name) === i).slice(0, MAX_CUSTOM_EMOJIS);
}

export type EmojiPart = { kind: 'text'; text: string } | { kind: 'emoji'; name: string; url: string };

// 閉じる「:」は次の絵文字の開きにもなりうるので、先読みにして食べない（`:a::b:` も `:x:b:` も読める）
const SHORTCODE = /:([A-Za-z0-9_+-]{1,64})(?=:)/g;

/** 文字を、ふつうの文字とカスタム絵文字（知っている `:name:` だけ）に分ける。知らない `:name:` は文字のまま。 */
export function splitCustomEmojis(text: string, emojis: readonly CustomEmoji[] | undefined): EmojiPart[] {
    if (!emojis || emojis.length === 0 || !text.includes(':')) return text ? [{ kind: 'text', text }] : [];
    const byName = new Map(emojis.map((e) => [e.name, e.url]));
    const parts = [...text.matchAll(SHORTCODE)].reduce<{ parts: EmojiPart[]; from: number }>(
        (acc, match) => {
            const url = byName.get(match[1] ?? '');
            if (!url || match.index < acc.from) return acc;
            const before = text.slice(acc.from, match.index);
            return {
                parts: [
                    ...acc.parts,
                    ...(before ? [{ kind: 'text' as const, text: before }] : []),
                    { kind: 'emoji', name: match[1] ?? '', url },
                ],
                from: match.index + match[0].length + 1,
            };
        },
        { parts: [], from: 0 },
    );
    const rest = text.slice(parts.from);
    return rest ? [...parts.parts, { kind: 'text', text: rest }] : parts.parts;
}
