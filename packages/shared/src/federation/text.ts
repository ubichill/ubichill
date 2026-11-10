import { type HtmlToken, tokenizeHtml } from './html';

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** HTML に埋め込む文字列をエスケープする（ほかの実装に送る自己紹介・ノートの本文）。 */
export const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c] ?? c);

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', amp: '&' };

/** 実体参照を文字に戻す（名前の付いたよく使うものと数値）。&amp; は 1 度だけ戻す（&amp;lt; は &lt; のまま）。 */
export function decodeEntities(text: string): string {
    return text.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]+);/gi, (whole, ref: string) => {
        const lower = ref.toLowerCase();
        if (lower.startsWith('#')) {
            const code = lower.startsWith('#x') ? Number.parseInt(lower.slice(2), 16) : Number(lower.slice(1));
            return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
        }
        return ENTITIES[lower] ?? whole;
    });
}

/** 制御文字を除き、空白を詰めて前後を落とす（1 行）。 */
const cleanLine = (text: string): string =>
    Array.from(text)
        .filter((c) => {
            const code = c.charCodeAt(0);
            return code >= 0x20 && code !== 0x7f;
        })
        .join('')
        .replace(/\s+/g, ' ')
        .trim();

const truncate = (text: string, max: number): string | null =>
    text ? Array.from(text).slice(0, max).join('').trim() || null : null;

/**
 * タグを除いた文字（実体参照はまだ戻さない）。`<br>` と段落の終わり（`</p>`）は、1 行なら空白、複数行なら改行と空行にする。
 */
export function tagText(token: HtmlToken, multiline: boolean): string {
    if (token.kind === 'text') return token.text;
    if (token.name === 'br') return multiline ? '\n' : ' ';
    if (token.name === 'p' && token.closing) return multiline ? '\n\n' : ' ';
    return '';
}

const plainOf = (html: string, multiline: boolean): string =>
    decodeEntities(
        tokenizeHtml(html)
            .map((t) => tagText(t, multiline))
            .join(''),
    );

/**
 * ほかのサーバーから来た文字列を表示に使う形にする（タグと制御文字を除き、前後の空白を落とし、max 文字に切る）。
 * ほかの実装の自己紹介は HTML なので、段落と改行は空白にしてから除き、実体参照は文字に戻す（表示はテキストとして行う）。
 */
export function displayText(text: string | null | undefined, max: number): string | null {
    if (text === null || text === undefined) return null;
    return truncate(cleanLine(plainOf(text, false)), max);
}

/**
 * 改行を残す版（自己紹介）。`<br>` は改行、段落の区切りは空行にする。行ごとに {@link displayText} と同じく整え、空行は 1 つまで。
 */
export function displayMultilineText(text: string | null | undefined, max: number): string | null {
    if (text === null || text === undefined) return null;
    const lines = plainOf(text, true)
        .split(/\r\n?|\n/)
        .map(cleanLine);
    return truncate(
        lines
            .join('\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim(),
        max,
    );
}
