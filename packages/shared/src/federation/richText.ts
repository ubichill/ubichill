/**
 * ほかの実装（Mastodon・Misskey）の HTML の文字（自己紹介）を、文字・リンク・メンションの並びにする。
 * タグはリンク（`<a>`）だけ意味を読み、ほかは除く。改行と段落は {@link displayMultilineText} と同じに扱う。
 * actor の `tag` にあるカスタム絵文字（`type: Emoji`）も読む。
 */
import { z } from 'zod';
import { formatAuthorAccount, parseAuthorAccount } from '../user/handle';
import {
    CUSTOM_EMOJI_NAME,
    type CustomEmoji,
    clipRichText,
    MAX_CUSTOM_EMOJIS,
    MAX_RICH_SEGMENTS,
    RICH_LINK_TEXT_MAX,
    type RichSegment,
} from '../user/richText';
import { displayMultilineText, displayText } from './text';
import { parseFederationUrl } from './urls';

const ANCHOR = /<a(\s[^>]*)?>([\s\S]*?)<\/a\s*>/gi;
// リンクの位置の印（私用領域の文字。元の文字にあれば先に除く）
const OPEN = '';
const CLOSE = '';
const MARKER_SPLIT = /(\d+)/;
const MARKER = /^(\d+)$/;

const decodeAttribute = (value: string): string =>
    value
        .replace(/&quot;/g, '"')
        .replace(/&#0*39;|&#x0*27;|&apos;/gi, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&');

function attributeOf(attributes: string, name: string): string | null {
    const match = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i').exec(attributes);
    return match ? decodeAttribute(match[1] ?? match[2] ?? match[3] ?? '') : null;
}

const MENTION_TEXT = /^@([^@\s]+)(?:@([^@\s]+))?$/;

/** メンションの文字（`@alice` か `@alice@example.com`）と行き先から、アカウントを読む。 */
function mentionAccount(text: string, href: { host: string }): string | null {
    const match = MENTION_TEXT.exec(text);
    if (!match) return null;
    const account = parseAuthorAccount(`${(match[1] ?? '').toLowerCase()}@${match[2] ?? href.host}`);
    return account ? formatAuthorAccount(account) : null;
}

function anchorSegment(attributes: string, inner: string, options: { allowHttp?: boolean }): RichSegment | null {
    const text = displayText(inner, RICH_LINK_TEXT_MAX);
    if (!text) return null;
    const href = parseFederationUrl(attributeOf(attributes, 'href'), options);
    if (!href) return { kind: 'text', text };
    if (MENTION_TEXT.test(text)) return { kind: 'mention', text, href: href.href, account: mentionAccount(text, href) };
    return { kind: 'link', text, href: href.href };
}

/** 続いた文字の区切りを 1 つにする。 */
const mergeText = (segments: readonly RichSegment[]): RichSegment[] =>
    segments.flatMap((segment, i): RichSegment[] => {
        if (segment.kind !== 'text') return [segment];
        if (segments[i - 1]?.kind === 'text') return [];
        const end = segments.findIndex((s, j) => j > i && s.kind !== 'text');
        const run = segments.slice(i, end === -1 ? undefined : end);
        return [{ kind: 'text', text: run.map((s) => s.text).join('') }];
    });

/**
 * HTML の自己紹介を区切りの並びにする（合わせて max 文字まで）。空なら空の並び。
 * リンクは http(s) のものだけ。メンション（文字が `@` で始まるリンク）はアカウントも読む。
 */
export function htmlToRichText(
    html: string | null | undefined,
    max: number,
    options: { allowHttp?: boolean } = {},
): RichSegment[] {
    if (!html) return [];
    const anchors: Array<RichSegment | null> = [];
    const marked = html.replace(/[]/g, '').replace(ANCHOR, (_whole, attributes: string, inner: string) => {
        anchors.push(anchorSegment(attributes ?? '', inner, options));
        return `${OPEN}${anchors.length - 1}${CLOSE}`;
    });
    // 印は 1 区切りが数文字なので、ここでは多めに残し、区切りにしてから max で切る
    const plain = displayMultilineText(marked, max + anchors.length * 8) ?? '';
    const segments = plain.split(MARKER_SPLIT).flatMap((part): RichSegment[] => {
        const marker = MARKER.exec(part);
        if (marker) {
            const anchor = anchors[Number(marker[1])];
            return anchor ? [anchor] : [];
        }
        // 切られて半端になった印は捨てる
        const text = part.replace(/\d*$/, '').replace(/[]/g, '');
        return text ? [{ kind: 'text', text }] : [];
    });
    return clipRichText(mergeText(segments), max).slice(0, MAX_RICH_SEGMENTS);
}

const ImageSchema = z.union([z.string(), z.object({ url: z.string() }).passthrough()]);
const EmojiTagSchema = z.object({ type: z.literal('Emoji'), name: z.string(), icon: ImageSchema }).passthrough();

/** actor の `tag` からカスタム絵文字を読む（`:name:` の名前・http(s) の画像。同じ名前は最初のもの）。 */
export function readCustomEmojis(tag: unknown, options: { allowHttp?: boolean } = {}): CustomEmoji[] {
    const items = Array.isArray(tag) ? tag : tag === undefined || tag === null ? [] : [tag];
    const emojis = items.flatMap((item): CustomEmoji[] => {
        const parsed = EmojiTagSchema.safeParse(item);
        if (!parsed.success) return [];
        const name = parsed.data.name.replace(/^:/, '').replace(/:$/, '');
        const icon = parsed.data.icon;
        const url = parseFederationUrl(typeof icon === 'string' ? icon : icon.url, options);
        return CUSTOM_EMOJI_NAME.test(name) && url ? [{ name, url: url.href }] : [];
    });
    return emojis.filter((e, i) => emojis.findIndex((f) => f.name === e.name) === i).slice(0, MAX_CUSTOM_EMOJIS);
}
