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
import { type HtmlToken, tokenizeHtml } from './html';
import { decodeEntities, displayText, tagText } from './text';
import { parseFederationUrl } from './urls';

const decodeAttribute = (value: string): string =>
    value
        .replace(/&quot;/g, '"')
        .replace(/&#0*39;|&#x0*27;|&apos;/gi, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&');

function attributeOf(raw: string, name: string): string | null {
    const match = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i').exec(raw);
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

type LinkSegment = Exclude<RichSegment, { kind: 'text' }>;
/** 文字（改行を含み、まだ整えていない）かリンク */
type Piece = string | LinkSegment;

function anchorPiece(openTag: string, inner: readonly HtmlToken[], options: { allowHttp?: boolean }): Piece {
    const text = displayText(inner.map((t) => (t.kind === 'text' ? t.text : t.raw)).join(''), RICH_LINK_TEXT_MAX);
    if (!text) return '';
    const href = parseFederationUrl(attributeOf(openTag, 'href'), options);
    if (!href) return text;
    if (MENTION_TEXT.test(text)) return { kind: 'mention', text, href: href.href, account: mentionAccount(text, href) };
    return { kind: 'link', text, href: href.href };
}

/** タグの並びを、文字とリンクの並びにする。`<a>` は対応する `</a>` までをリンクにし、閉じないものはタグとして捨てる。 */
function piecesOf(tokens: readonly HtmlToken[], options: { allowHttp?: boolean }): Piece[] {
    // それぞれの位置から見て次の `</a>` の位置（後ろから 1 度だけ数える）
    const nextClose = tokens.reduceRight<number[]>((acc, t, i) => {
        acc[i] = t.kind === 'tag' && t.name === 'a' && t.closing ? i : (acc[i + 1] ?? -1);
        return acc;
    }, []);
    const pieces: Piece[] = [];
    const cursor = { at: 0 };
    while (cursor.at < tokens.length) {
        const token = tokens[cursor.at] as HtmlToken;
        const close = nextClose[cursor.at + 1] ?? -1;
        if (token.kind === 'tag' && token.name === 'a' && !token.closing && close !== -1) {
            pieces.push(anchorPiece(token.raw, tokens.slice(cursor.at + 1, close), options));
            cursor.at = close + 1;
            continue;
        }
        pieces.push(token.kind === 'text' ? decodeEntities(token.text) : tagText(token, true));
        cursor.at += 1;
    }
    return pieces;
}

/** 1 行を整える（文字はつないでから制御文字を除き空白を詰め、行の両端の空白を落とす）。 */
function tidyLine(line: readonly Piece[]): Piece[] {
    const merged = line.reduce<Piece[]>((out, piece) => {
        const last = out.at(-1);
        if (typeof piece === 'string' && typeof last === 'string') out[out.length - 1] = last + piece;
        else out.push(piece);
        return out;
    }, []);
    const cleaned = merged.map((p) => (typeof p === 'string' ? cleanSpaces(p) : p));
    const first = cleaned[0];
    if (typeof first === 'string') cleaned[0] = first.trimStart();
    const last = cleaned.at(-1);
    if (typeof last === 'string') cleaned[cleaned.length - 1] = last.trimEnd();
    return cleaned.filter((p) => p !== '');
}

const cleanSpaces = (text: string): string =>
    Array.from(text)
        .filter((c) => {
            const code = c.charCodeAt(0);
            return code >= 0x20 && code !== 0x7f;
        })
        .join('')
        .replace(/\s+/g, ' ');

/** 行に分けて整え、空行は 1 つまで、前後の空行は落として、区切りの並びにする。 */
function segmentsOf(pieces: readonly Piece[]): RichSegment[] {
    const lines: Piece[][] = [[]];
    for (const piece of pieces) {
        if (typeof piece !== 'string') {
            lines[lines.length - 1]?.push(piece);
            continue;
        }
        piece.split(/\r\n?|\n/).forEach((part, k) => {
            if (k > 0) lines.push([]);
            if (part) lines[lines.length - 1]?.push(part);
        });
    }
    const tidy = lines.map(tidyLine);
    const kept = tidy.filter((line, i) => line.length > 0 || (i > 0 && (tidy[i - 1]?.length ?? 0) > 0));
    const start = kept.findIndex((line) => line.length > 0);
    const end = kept.findLastIndex((line) => line.length > 0);
    if (start === -1) return [];
    const flat = kept
        .slice(start, end + 1)
        .flatMap((line, i): RichSegment[] => [
            ...(i > 0 ? [{ kind: 'text' as const, text: '\n' }] : []),
            ...line.map((p): RichSegment => (typeof p === 'string' ? { kind: 'text', text: p } : p)),
        ]);
    return mergeText(flat);
}

/** 続いた文字の区切りを 1 つにする。 */
const mergeText = (segments: readonly RichSegment[]): RichSegment[] =>
    segments.reduce<RichSegment[]>((out, segment) => {
        const last = out.at(-1);
        if (segment.kind === 'text' && last?.kind === 'text')
            out[out.length - 1] = { kind: 'text', text: last.text + segment.text };
        else out.push(segment);
        return out;
    }, []);

/**
 * HTML の自己紹介を区切りの並びにする（合わせて max 文字まで）。空なら空の並び。
 * リンクは http(s) のものだけ。メンション（文字が `@` で始まるリンク）はアカウントも読む。
 * 前から 1 度だけ読む（壊れた HTML でも入力の長さに比例する）。文字とリンクは別の値として持つので、文字からリンクは作れない。
 */
export function htmlToRichText(
    html: string | null | undefined,
    max: number,
    options: { allowHttp?: boolean } = {},
): RichSegment[] {
    if (!html) return [];
    return clipRichText(segmentsOf(piecesOf(tokenizeHtml(html), options)), max).slice(0, MAX_RICH_SEGMENTS);
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
