const ENTITIES: Record<string, string> = { lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', amp: '&' };

/** 実体参照を文字に戻す（名前の付いたよく使うものと数値）。&amp; は 1 度だけ戻す（&amp;lt; は &lt; のまま）。 */
function decodeEntities(text: string): string {
    return text.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]+);/gi, (whole, ref: string) => {
        const lower = ref.toLowerCase();
        if (lower.startsWith('#')) {
            const code = lower.startsWith('#x') ? Number.parseInt(lower.slice(2), 16) : Number(lower.slice(1));
            return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
        }
        return ENTITIES[lower] ?? whole;
    });
}

/**
 * ほかのサーバーから来た文字列を表示に使う形にする（タグと制御文字を除き、前後の空白を落とし、max 文字に切る）。
 * ほかの実装の自己紹介は HTML なので、段落と改行は空白にしてから除き、実体参照は文字に戻す（表示はテキストとして行う）。
 */
export function displayText(text: string | null | undefined, max: number): string | null {
    const withoutTags =
        text === null || text === undefined
            ? undefined
            : decodeEntities(text.replace(/<br\s*\/?>|<\/p>/gi, ' ').replace(/<[^>]*>/g, ''));
    const clean = Array.from(withoutTags ?? '')
        .filter((c) => {
            const code = c.charCodeAt(0);
            return code >= 0x20 && code !== 0x7f;
        })
        .join('')
        .replace(/\s+/g, ' ')
        .trim();
    return clean ? Array.from(clean).slice(0, max).join('') : null;
}
